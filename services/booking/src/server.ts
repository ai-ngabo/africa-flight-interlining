import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config, fetchJson, type Itinerary } from '@pai/shared';
import { ConcurrencyError, createRepo } from './repo';
import { BookingError, BookingService } from './service';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
const repo = await createRepo((m) => app.log.warn(m));

const svc = new BookingService(repo, async (q) => {
  const res = await fetchJson<{ itineraries: Itinerary[] }>(`${config.searchUrl}/v1/search`, {
    method: 'POST',
    body: JSON.stringify({ ...q, sort: 'fastest', limit: 20 }),
    timeoutMs: 8000,
  });
  return res.itineraries;
});

const isInternal = (r: FastifyRequest) => r.headers['x-internal-key'] === config.internalKey;
const userId = (r: FastifyRequest) => (r.headers['x-user-id'] as string | undefined) ?? '';

async function owned(r: FastifyRequest, pnr: string) {
  const b = await svc.get(pnr);
  if (!isInternal(r) && b.userId !== userId(r)) throw new BookingError('Not found', 404, 'not_found');
  return b;
}

app.setErrorHandler((err, _req, reply: FastifyReply) => {
  if (err instanceof BookingError) return reply.code(err.status).send({ error: err.code, message: err.message });
  if (err instanceof ConcurrencyError) return reply.code(409).send({ error: 'conflict', message: err.message });
  if (err instanceof z.ZodError) return reply.code(400).send({ error: 'invalid_request', details: err.flatten() });
  app.log.error(err);
  return reply.code(500).send({ error: 'internal', message: 'Unexpected error' });
});

const CreateSchema = z.object({
  offerToken: z.string().min(20).max(20_000),
  addProtection: z.boolean().default(false),
  passengers: z.array(z.object({
    firstName: z.string().trim().min(1).max(60),
    lastName: z.string().trim().min(1).max(60),
    nationality: z.string().trim().toUpperCase().length(2),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    documentNumber: z.string().trim().max(20).optional(),
  })).min(1).max(9),
  contact: z.object({ phone: z.string().trim().regex(/^\+?\d{8,15}$/), email: z.string().email().optional() }),
});

app.addHook('onRequest', async (req, reply) => {
  if (req.url.startsWith('/internal/') && !isInternal(req)) return reply.code(401).send({ error: 'unauthorized' });
  if (req.url.startsWith('/v1/') && !userId(req) && !isInternal(req)) return reply.code(401).send({ error: 'unauthorized', message: 'Missing user identity' });
});

app.get('/health', async () => ({ status: 'ok', store: repo.kind }));

app.post('/v1/bookings', async (req, reply) => {
  const body = CreateSchema.parse(req.body);
  const b = await svc.create(userId(req), body);
  return reply.code(201).send(b);
});
app.get('/v1/bookings', async (req) => ({ bookings: await repo.listByUser(userId(req)) }));
app.get('/v1/bookings/:pnr', async (req) => owned(req, (req.params as { pnr: string }).pnr.toUpperCase()));
app.get('/v1/bookings/:pnr/ledger', async (req) => {
  const b = await owned(req, (req.params as { pnr: string }).pnr.toUpperCase());
  return { pnr: b.pnr, entries: await repo.ledger(b.pnr) };
});

// Simulation endpoint: in production this is driven by a flight-status feed, not the customer.
app.post('/v1/bookings/:pnr/disruptions', async (req) => {
  const b = await owned(req, (req.params as { pnr: string }).pnr.toUpperCase());
  const { legIndex, delayMinutes } = z.object({ legIndex: z.number().int().min(0), delayMinutes: z.number().int().min(1).max(2880) }).parse(req.body);
  return svc.reportDisruption(b.pnr, legIndex, delayMinutes);
});

app.get('/internal/bookings/:pnr', async (req) => svc.get((req.params as { pnr: string }).pnr.toUpperCase()));
app.post('/internal/bookings/:pnr/confirm-payment', async (req) => {
  const p = z.object({ paymentId: z.string(), rail: z.string(), payerCurrency: z.string(), payerAmount: z.number(), amountUsd: z.number() }).parse(req.body);
  return svc.confirmPayment((req.params as { pnr: string }).pnr.toUpperCase(), p);
});

await app.listen({ port: Number(process.env.BOOKING_PORT ?? 4002), host: '0.0.0.0' });
