import { config, fetchJson, round2, signOffer, type Assessment, type BaggageWarning, type Itinerary, type OfferPayload } from '@pai/shared';
import type { NetworkGraph } from './graph';

interface IntelResult {
  id: string;
  riskScore: number;
  riskLabel: Assessment['riskLabel'];
  connectionRisks: number[];
  protectionPremiumUsd: number;
  travelDocStatus: Assessment['travelDocStatus'];
  visaFlags: Assessment['visaFlags'];
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Used only if the Python intelligence service is unreachable — keeps search available. */
function fallbackAssessment(it: Itinerary): Omit<Assessment, 'baggageWarnings'> {
  const risks = it.connections.map((c, i) => {
    const inbound = it.legs[i];
    const x = -c.bufferMin / 25 + (1 - inbound.carrierOtp) * 3 + c.terminalComplexity * 0.15 + (c.weatherRisk ? 0.4 : 0) - 1.2;
    const p = sigmoid(x);
    return round2(c.type === 'protected' ? p * 0.15 : p);
  });
  const riskScore = round2(1 - risks.reduce((a, p) => a * (1 - p), 1));
  const premium = it.connections.reduce((sum, c, i) => {
    if (c.type === 'protected') return sum;
    const onward = it.legs.slice(i + 1).reduce((a, l) => a + l.fareUsd, 0);
    return sum + risks[i] * (onward + (it.legs[i + 1].frequencyPerWeek < 7 ? 80 : 40));
  }, 0);
  return {
    source: 'fallback',
    riskScore,
    riskLabel: riskScore < 0.1 ? 'low' : riskScore < 0.25 ? 'medium' : 'high',
    connectionRisks: risks,
    protectionPremiumUsd: it.isVirtualInterline ? round2(Math.max(3, premium * 1.35 + 2)) : 0,
    travelDocStatus: 'unknown',
    visaFlags: [],
  };
}

export function baggageWarnings(graph: NetworkGraph, it: Itinerary): BaggageWarning[] {
  const out: BaggageWarning[] = [];
  it.connections.forEach((c, i) => {
    if (c.type === 'protected') return;
    const a = graph.carriers.get(it.legs[i].carrier)!;
    const b = graph.carriers.get(it.legs[i + 1].carrier)!;
    out.push({ at: c.arriveAt, message: `Self-transfer: collect your bags at ${c.arriveAt} and check in again with ${b.name}.` });
    const allowA = a.checkedBags * a.checkedBagKg;
    const allowB = b.checkedBags * b.checkedBagKg;
    if (allowB < allowA) {
      out.push({
        at: c.departFrom,
        message: `${b.name} allows ${b.checkedBags}x${b.checkedBagKg}kg vs ${a.name} ${a.checkedBags}x${a.checkedBagKg}kg — excess baggage fees may apply. Pack to ${b.checkedBags ? `${b.checkedBags}x${b.checkedBagKg}kg` : 'cabin bag only'}.`,
      });
    }
  });
  return out;
}

export async function assess(graph: NetworkGraph, its: Itinerary[], nationality: string | undefined): Promise<void> {
  if (!its.length) return;
  let results: Map<string, IntelResult> | undefined;
  try {
    const month = new Date(its[0].departureUtc).getUTCMonth() + 1;
    const body = {
      nationality: nationality ?? null,
      month,
      itineraries: its.map((it) => ({
        id: it.id,
        originCountry: it.legs[0].fromCountry,
        destinationCountry: it.legs[it.legs.length - 1].toCountry,
        legs: it.legs.map(({ carrier, mode, from, to, fromCountry, toCountry, durationMin, fareUsd, carrierOtp, delayStdMin, frequencyPerWeek }) => ({
          carrier, mode, from, to, fromCountry, toCountry, durationMin, fareUsd, carrierOtp, delayStdMin, frequencyPerWeek,
        })),
        connections: it.connections,
      })),
    };
    const res = await fetchJson<{ results: IntelResult[] }>(`${config.intelUrl}/v1/assess`, { method: 'POST', body: JSON.stringify(body), timeoutMs: 2500 });
    results = new Map(res.results.map((r) => [r.id, r]));
  } catch {
    results = undefined; // degrade gracefully
  }
  for (const it of its) {
    const r = results?.get(it.id);
    const base = r ? { source: 'intelligence' as const, ...r } : fallbackAssessment(it);
    delete (base as Partial<IntelResult>).id;
    it.assessment = { ...base, baggageWarnings: baggageWarnings(graph, it) } as Assessment;
    it.price.protectionPremiumUsd = it.assessment.protectionPremiumUsd;
    it.price.totalWithProtectionUsd = round2(it.price.totalWithoutProtectionUsd + it.assessment.protectionPremiumUsd);
  }
}

export function rankAndTag(its: Itinerary[], sort: string): Itinerary[] {
  if (!its.length) return its;
  const minPrice = Math.min(...its.map((i) => i.price.totalWithoutProtectionUsd));
  const minDur = Math.min(...its.map((i) => i.totalDurationMin));
  const score = (i: Itinerary) =>
    i.price.totalWithoutProtectionUsd / minPrice + (i.totalDurationMin / minDur) * 0.6 + (i.assessment?.riskScore ?? 0) * 2 + (i.assessment?.travelDocStatus === 'visa_required' ? 0.5 : 0);
  const cmp: Record<string, (a: Itinerary, b: Itinerary) => number> = {
    best: (a, b) => score(a) - score(b),
    cheapest: (a, b) => a.price.totalWithoutProtectionUsd - b.price.totalWithoutProtectionUsd,
    fastest: (a, b) => a.totalDurationMin - b.totalDurationMin,
    safest: (a, b) => (a.assessment?.riskScore ?? 0) - (b.assessment?.riskScore ?? 0) || a.price.totalWithoutProtectionUsd - b.price.totalWithoutProtectionUsd,
  };
  const sorted = [...its].sort(cmp[sort] ?? cmp.best);
  const cheapest = [...its].sort(cmp.cheapest)[0];
  const fastest = [...its].sort(cmp.fastest)[0];
  const safest = [...its].sort(cmp.safest)[0];
  for (const it of sorted) {
    const tags = new Set<string>();
    if (it === cheapest) tags.add('cheapest');
    if (it === fastest) tags.add('fastest');
    if (it === safest && it.connections.length) tags.add('lowest_risk');
    if (it === sorted[0] && sort === 'best') tags.add('recommended');
    if (it.legs.length === 1) tags.add('direct');
    if (it.modes.length > 1) tags.add('multi_modal');
    if (it.isVirtualInterline) tags.add('virtual_interline');
    if (it.connections.some((c) => c.overnight)) tags.add('overnight_layover');
    if (it.fairness.label === 'good_value') tags.add('good_value');
    if (it.fairness.label === 'above_benchmark') tags.add('above_fair_benchmark');
    it.tags = [...tags];
  }
  return sorted;
}

export function attachOffers(its: Itinerary[], ttlMin = 20): void {
  const now = Date.now();
  for (const it of its) {
    const payload: OfferPayload = {
      itineraryId: it.id,
      legs: it.legs.map(({ carrier, carrierName, number, mode, from, to, depUtc, arrUtc, fareUsd, taxUsd }) => ({ carrier, carrierName, number, mode, from, to, depUtc, arrUtc, fareUsd, taxUsd })),
      connections: it.connections.map(({ arriveAt, departFrom, type, requiredMin }) => ({ arriveAt, departFrom, type, requiredMin })),
      price: it.price,
      riskScore: it.assessment?.riskScore ?? 0,
      destination: it.legs[it.legs.length - 1].to,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMin * 60_000).toISOString(),
    };
    it.offerToken = signOffer(payload);
  }
}
