import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { z } from 'zod';
import { config, convert, crossRate, fetchJson, fxInfo, hasCurrency, internalHeaders, refreshRates } from '@pai/shared';
import { buildRails, railsFor, type RailId, type RailRequest, type RailStatus } from './rails';
import { settlementPlan } from './settlement';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
const rails = buildRails();
await refreshRates();

interface Payment {
  paymentId: string;
  pnr: string;
  userId: string;
  status: RailStatus;
  rail?: RailId;
  providerRef?: string;
  mode?: string;
  instructions?: string;
  request: RailRequest;
  amountUsd: number;
  attempts: Array<{ rail: RailId; ok: boolean; error?: string }>;
  settlement: ReturnType<typeof settlementPlan>;
  createdAt: string;
  bookingConfirmed: boolean;
}
// MVP: in-memory payment intents. Production: persist in PostgreSQL alongside the ledger.
const payments = new Map<string, Payment>();

const PaySchema = z.object({
  pnr: z.string().trim().toUpperCase().length(6),
  method: z.enum(['papss', 'mtn_momo', 'mpesa', 'airtel_money', 'card']).optional(),
  payer: z.object({
    phone: z.string().trim().regex(/^\+?\d{8,15}$/),
    country: z.string().trim().toUpperCase().length(2),
    currency: z.string().trim().toUpperCase().length(3),
  }),
});

app.get('/health', async () => ({ status: 'ok', rails: Object.values(rails).map((r) => ({ id: r.id, name: r.name })), fx: fxInfo() }));

app.get('/v1/payments/methods', async (req) => {
  const country = String((req.query as Record<string, string>).country ?? '').toUpperCase();
  return { country, methods: railsFor(country).map((id) => ({ id, name: rails[id].name })) };
});

app.get('/v1/fx/quote', async (req, reply) => {
  const q = req.query as Record<string, string>;
  const from = (q.from ?? '').toUpperCase();
  const to = (q.to ?? '').toUpperCase();
  const amount = Number(q.amount ?? 1);
  if (!hasCurrency(from) || !hasCurrency(to) || !Number.isFinite(amount)) return reply.code(400).send({ error: 'unsupported_currency' });
  return { from, to, amount, converted: convert(amount, from, to), directRate: crossRate(from, to), ...fxInfo() };
});

async function confirmWithBooking(p: Payment) {
  if (p.bookingConfirmed) return;
  try {
    await fetchJson(`${config.bookingUrl}/internal/bookings/${p.pnr}/confirm-payment`, {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify({ paymentId: p.paymentId, rail: p.rail, payerCurrency: p.request.currency, payerAmount: p.request.amount, amountUsd: p.amountUsd }),
    });
    p.bookingConfirmed = true;
  } catch (err) {
    app.log.error({ err, paymentId: p.paymentId }, 'booking confirmation failed; will retry on next status check');
  }
}

/** Background poller: rails are asynchronous (USSD/STK prompts), so we poll until a terminal state. */
function poll(p: Payment, deadline = Date.now() + 3 * 60_000) {
  const tick = async () => {
    if (p.status === 'pending' && p.rail && p.providerRef) {
      try {
        p.status = await rails[p.rail].check(p.providerRef, p.request);
      } catch (err) {
        app.log.warn({ err }, 'rail status check failed');
      }
    }
    if (p.status === 'succeeded') await confirmWithBooking(p);
    if ((p.status === 'pending' || (p.status === 'succeeded' && !p.bookingConfirmed)) && Date.now() < deadline) setTimeout(tick, 1000);
    else if (p.status === 'pending') p.status = 'failed';
  };
  setTimeout(tick, 800);
}

app.post('/v1/payments', async (req, reply) => {
  const userId = req.headers['x-user-id'] as string | undefined;
  if (!userId) return reply.code(401).send({ error: 'unauthorized' });
  const parsed = PaySchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
  const { pnr, method, payer } = parsed.data;
  if (!hasCurrency(payer.currency)) return reply.code(400).send({ error: 'unsupported_currency' });

  const booking = await fetchJson<any>(`${config.bookingUrl}/internal/bookings/${pnr}`, { headers: internalHeaders() }).catch(() => null);
  if (!booking || booking.userId !== userId) return reply.code(404).send({ error: 'not_found' });
  if (booking.status !== 'PENDING_PAYMENT') return reply.code(409).send({ error: 'invalid_state', message: `Booking is ${booking.status}` });

  const paymentId = `pay_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const request: RailRequest = { paymentId, pnr, phone: payer.phone, currency: payer.currency, amount: convert(booking.amountUsd, 'USD', payer.currency) };
  const order = [...new Set<RailId>([...(method ? [method] : []), ...railsFor(payer.country)])];
  const p: Payment = {
    paymentId, pnr, userId, status: 'failed', request, amountUsd: booking.amountUsd, attempts: [],
    settlement: settlementPlan(booking, payer.currency), createdAt: new Date().toISOString(), bookingConfirmed: false,
  };
  // Mobile Money Fallback Router: try the preferred rail, then the next available one for the payer's country.
  for (const id of order) {
    try {
      const r = await rails[id].request(request);
      Object.assign(p, { status: r.status, rail: id, providerRef: r.providerRef, mode: r.mode, instructions: r.instructions });
      p.attempts.push({ rail: id, ok: true });
      break;
    } catch (err) {
      p.attempts.push({ rail: id, ok: false, error: (err as Error).message });
    }
  }
  payments.set(paymentId, p);
  if (p.status !== 'failed') poll(p);
  return reply.code(p.status === 'failed' ? 402 : 202).send(publicView(p));
});

function publicView(p: Payment) {
  const { request, userId: _u, providerRef: _r, ...rest } = p;
  return { ...rest, payerAmount: request.amount, payerCurrency: request.currency };
}

app.get('/v1/payments/:id', async (req, reply) => {
  const p = payments.get((req.params as { id: string }).id);
  if (!p || p.userId !== req.headers['x-user-id']) return reply.code(404).send({ error: 'not_found' });
  return publicView(p);
});

await app.listen({ port: Number(process.env.PAYMENT_PORT ?? 4003), host: '0.0.0.0' });
