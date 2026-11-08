import type { Itinerary, SearchRequest } from '@pai/shared';
import { assess, attachOffers, rankAndTag } from './assess';
import type { Cache } from './cache';
import type { NetworkGraph } from './graph';
import { findItineraries, paretoFilter } from './router';

export interface SearchResponse {
  request: SearchRequest;
  count: number;
  itineraries: Itinerary[];
  meta: { cache: 'hit' | 'miss'; candidatesExamined: number; assessment: string; tookMs: number };
}

const preScore = (i: Itinerary) => i.price.totalWithoutProtectionUsd / 100 + i.totalDurationMin / 60;

/**
 * Pareto-optimal options first (nothing is both cheaper and faster with fewer
 * transfers), then the best remaining options so travellers still see choices
 * of time and carrier — at most 2 per routing (same carriers + same hubs).
 */
export function diverseShortlist(all: Itinerary[], max: number): Itinerary[] {
  const front = paretoFilter(all);
  const inFront = new Set(front.map((i) => i.id));
  const perRouting = new Map<string, number>();
  const routing = (i: Itinerary) => i.legs.map((l) => `${l.carrier}:${l.from}`).join('>');
  for (const i of front) perRouting.set(routing(i), (perRouting.get(routing(i)) ?? 0) + 1);
  const rest: Itinerary[] = [];
  for (const i of [...all].sort((a, b) => preScore(a) - preScore(b))) {
    if (inFront.has(i.id)) continue;
    const k = routing(i);
    if ((perRouting.get(k) ?? 0) >= 2) continue;
    perRouting.set(k, (perRouting.get(k) ?? 0) + 1);
    rest.push(i);
  }
  return [...front.sort((a, b) => preScore(a) - preScore(b)), ...rest].slice(0, max);
}

export async function search(graph: NetworkGraph, cache: Cache, req: SearchRequest): Promise<SearchResponse> {
  const t0 = Date.now();
  const key = `search:v1:${JSON.stringify(req)}`;
  const hit = await cache.get(key);
  if (hit) {
    const res = JSON.parse(hit) as SearchResponse;
    return { ...res, meta: { ...res.meta, cache: 'hit', tookMs: Date.now() - t0 } };
  }
  const all = findItineraries(graph, req);
  const shortlist = diverseShortlist(all, 40);
  await assess(graph, shortlist, req.nationality);
  const ranked = rankAndTag(shortlist, req.sort ?? 'best').slice(0, Math.min(req.limit ?? 15, 40));
  attachOffers(ranked);
  const res: SearchResponse = {
    request: req,
    count: ranked.length,
    itineraries: ranked,
    meta: {
      cache: 'miss',
      candidatesExamined: all.length,
      assessment: ranked[0]?.assessment?.source ?? 'none',
      tookMs: Date.now() - t0,
    },
  };
  // Short TTL: offer tokens inside expire after 20 min, live fares would change faster.
  await cache.set(key, JSON.stringify(res), 300);
  return res;
}
