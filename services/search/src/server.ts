import Fastify from 'fastify';
import { z } from 'zod';
import { refreshRates } from '@pai/shared';
import { createCache } from './cache';
import { NetworkGraph } from './graph';
import { search } from './service';
import { loadNetwork } from './store';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
const log = (m: string) => app.log.warn(m);

const { data, source } = await loadNetwork(log);
const graph = new NetworkGraph(data);
const cache = await createCache(log);
await refreshRates();

const code = z.string().trim().toUpperCase().min(3).max(8);
const SearchSchema = z.object({
  origin: code,
  destination: code,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  nationality: z.string().trim().toUpperCase().length(2).optional(),
  maxLegs: z.coerce.number().int().min(1).max(4).optional(),
  modes: z.array(z.enum(['flight', 'bus'])).optional(),
  sort: z.enum(['best', 'cheapest', 'fastest', 'safest']).optional(),
  limit: z.coerce.number().int().min(1).max(40).optional(),
  earliestDepartureUtc: z.string().datetime().optional(),
});

app.get('/health', async () => ({ status: 'ok', graphSource: source, cache: cache.kind, nodes: graph.nodes.size, services: data.services.length }));

app.get('/v1/meta', async () => ({
  nodes: data.nodes.map(({ code, name, metro, country, currency, type }) => ({ code, name, metro, country, currency, type })),
  carriers: data.carriers.map(({ code, name, mode, hub }) => ({ code, name, mode, hub })),
}));

async function handle(input: unknown, reply: import('fastify').FastifyReply) {
  const parsed = SearchSchema.safeParse(input);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
  const req = parsed.data;
  if (!graph.nodes.has(req.origin) || !graph.nodes.has(req.destination)) {
    return reply.code(404).send({ error: 'unknown_location', message: `Unknown origin or destination (${req.origin}, ${req.destination})` });
  }
  try {
    return await search(graph, cache, req);
  } catch (err) {
    return reply.code(400).send({ error: 'search_failed', message: (err as Error).message });
  }
}

app.post('/v1/search', async (request, reply) => handle(request.body, reply));
app.get('/v1/search', async (request, reply) => {
  const q = request.query as Record<string, string>;
  return handle({ ...q, modes: q.modes ? q.modes.split(',') : undefined }, reply);
});

const port = Number(process.env.SEARCH_PORT ?? 4001);
await app.listen({ port, host: '0.0.0.0' });
