import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import compress from '@fastify/compress';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import proxy from '@fastify/http-proxy';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '@pai/shared';
import { issueOtp, signToken, verifyOtp, verifyToken } from './auth';
import { handleUssd } from './ussd';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, trustProxy: true });
const dev = process.env.NODE_ENV !== 'production';

// Payload compression matters on 3G: brotli/gzip for JSON and static assets.
await app.register(compress, { global: true, encodings: ['br', 'gzip'], threshold: 512 });
await app.register(cors, { origin: dev ? true : (process.env.CORS_ORIGIN ?? false) });
await app.register(formbody);
await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

type AuthedRaw = FastifyRequest['raw'] & { userId?: string };

async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const h = req.headers.authorization;
  const userId = h?.startsWith('Bearer ') ? await verifyToken(h.slice(7)) : null;
  if (!userId) return reply.code(401).send({ error: 'unauthorized', message: 'Sign in with your phone number first' });
  (req.raw as AuthedRaw).userId = userId;
}

/** Never let clients spoof internal identity headers; inject the verified user id instead. */
const rewriteRequestHeaders = (original: any, headers: Record<string, any>) => {
  const h = { ...headers };
  delete h['x-internal-key'];
  delete h['x-user-id'];
  delete h.authorization;
  const uid = original?.userId ?? original?.raw?.userId;
  if (uid) h['x-user-id'] = uid;
  return h;
};

const route = (prefix: string, upstream: string, rewritePrefix: string, opts: { auth?: boolean; rate?: number } = {}) =>
  app.register(proxy, {
    upstream,
    prefix,
    rewritePrefix,
    preHandler: opts.auth ? requireUser : undefined,
    replyOptions: { rewriteRequestHeaders },
    config: opts.rate ? { rateLimit: { max: opts.rate, timeWindow: '1 minute' } } : undefined,
  });

await route('/api/search', config.searchUrl, '/v1/search', { rate: 30 });
await route('/api/meta', config.searchUrl, '/v1/meta');
await route('/api/assist', config.intelUrl, '/v1/agent', { rate: 10 });
await route('/api/visa', config.intelUrl, '/v1/visa');
await route('/api/fx', config.paymentUrl, '/v1/fx');
await route('/api/bookings', config.bookingUrl, '/v1/bookings', { auth: true });
await route('/api/payments', config.paymentUrl, '/v1/payments', { auth: true });

const Phone = z.string().trim().regex(/^\+?\d{8,15}$/);

app.post('/api/auth/otp', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
  const parsed = z.object({ phone: Phone }).safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid_phone' });
  const code = issueOtp(parsed.data.phone);
  req.log.info({ phone: parsed.data.phone.slice(0, 5) + '***' }, 'OTP issued');
  return { sent: true, ...(dev ? { devCode: code, note: 'devCode is returned only in development; production sends SMS' } : {}) };
});

app.post('/api/auth/verify', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
  const parsed = z.object({ phone: Phone, code: z.string().regex(/^\d{6}$/) }).safeParse(req.body);
  if (!parsed.success || !verifyOtp(parsed.data.phone, parsed.data.code)) return reply.code(401).send({ error: 'invalid_code' });
  return { token: await signToken(parsed.data.phone), expiresIn: 86400 };
});

app.post('/ussd', async (req, reply) => {
  const b = req.body as Record<string, string>;
  reply.type('text/plain');
  return handleUssd(b.text ?? '', b.phoneNumber ?? '');
});

app.get('/api/health', async () => {
  const check = async (name: string, url: string) => {
    try {
      const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
      return [name, r.ok ? await r.json() : { status: `http ${r.status}` }];
    } catch {
      return [name, { status: 'down' }];
    }
  };
  const results = await Promise.all([
    check('search', config.searchUrl), check('booking', config.bookingUrl), check('payment', config.paymentUrl), check('intelligence', config.intelUrl),
  ]);
  return { gateway: 'ok', services: Object.fromEntries(results) };
});

// Serve the statically exported PWA (npm run build:web) from the edge.
const webOut = resolve(dirname(fileURLToPath(import.meta.url)), '../../../web/out');
if (existsSync(webOut)) {
  await app.register(fastifyStatic, { root: webOut, maxAge: '1h', setHeaders: (res, path) => {
    // @fastify/static v10 passes a FastifyReply; the service worker must never be cached stale.
    if (path.endsWith('sw.js')) res.header('cache-control', 'no-cache');
  } });
} else {
  app.get('/', async () => ({ message: 'API gateway running. Build the PWA with `npm run build:web` to serve it here.' }));
}

await app.listen({ port: Number(process.env.PORT ?? 8080), host: '0.0.0.0' });
