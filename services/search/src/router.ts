import { createHash } from 'node:crypto';
import { round2, type Connection, type Itinerary, type Leg, type Mode, type SearchRequest, type TransitNode } from '@pai/shared';
import { fmtLocal, parseDate, type Instance, type NetworkGraph } from './graph';

const MIN = 60_000;
const HOUR = 60 * MIN;

export interface RouterOptions {
  maxLayoverMin: number;
  maxTotalHoursFlight: number;
  maxTotalHoursMultiModal: number;
  maxCandidates: number;
}

const DEFAULTS: RouterOptions = {
  maxLayoverMin: 20 * 60,
  maxTotalHoursFlight: 40,
  maxTotalHoursMultiModal: 60,
  maxCandidates: 5000,
};

interface Step {
  inst: Instance;
  conn?: Connection; // connection *before* this step
}

export const platformFee = (baseUsd: number) => round2(Math.min(baseUsd * 0.03, 12));

function crossesLocalMidnight(arrMs: number, depMs: number, offset: number): boolean {
  return fmtLocal(arrMs, offset).slice(0, 10) !== fmtLocal(depMs, offset).slice(0, 10);
}

/**
 * Time-dependent depth-first search over the dated network (the "segment
 * stitching algorithm"). Each hop is classified as protected, self-transfer or
 * ground transfer, and must respect the corresponding minimum connection time.
 */
export function findItineraries(graph: NetworkGraph, req: SearchRequest, opts: Partial<RouterOptions> = {}): Itinerary[] {
  const o = { ...DEFAULTS, ...opts };
  const origin = graph.node(req.origin);
  const dest = graph.node(req.destination);
  if (origin.metro === dest.metro) throw new Error('Origin and destination are in the same city');
  const modes = new Set<Mode>(req.modes?.length ? req.modes : ['flight', 'bus']);
  const maxLegs = Math.min(Math.max(req.maxLegs ?? 3, 1), 4);

  let windowStart: number;
  let windowEnd: number;
  if (req.earliestDepartureUtc) {
    windowStart = new Date(req.earliestDepartureUtc).getTime();
    windowEnd = windowStart + 36 * HOUR;
  } else {
    windowStart = parseDate(req.date) - origin.utcOffset * HOUR;
    windowEnd = windowStart + 24 * HOUR;
  }

  const originNodes = graph.metro.get(origin.metro) ?? [origin];
  const destMetro = dest.metro;
  const results: Step[][] = [];

  const visit = (node: TransitNode, arrMs: number, path: Step[], visitedMetros: Set<string>, firstDep: number) => {
    if (results.length >= o.maxCandidates || path.length >= maxLegs) return;
    const prev = path[path.length - 1].inst;
    const prevCarrier = graph.carriers.get(prev.service.carrier)!;
    const anyBus = path.some((s) => s.inst.service.mode === 'bus');
    const maxTotal = (anyBus || modes.has('bus') ? o.maxTotalHoursMultiModal : o.maxTotalHoursFlight) * HOUR;

    for (const next of graph.metro.get(node.metro) ?? [node]) {
      const ground = next.code !== node.code;
      const groundMin = ground ? node.accessMin + next.accessMin : 0;
      const exitMin = node.type === 'airport' ? Math.round(node.mctSelfTransfer * 0.4) : 10;
      const minGap = ground ? exitMin + groundMin + next.checkinMin : Math.min(node.mctProtected, node.mctSelfTransfer);
      const deps = graph.departures(next.code, arrMs + minGap * MIN, arrMs + o.maxLayoverMin * MIN);

      for (const inst of deps) {
        const s = inst.service;
        if (!modes.has(s.mode)) continue;
        const toNode = graph.node(s.to);
        if (visitedMetros.has(toNode.metro)) continue;
        if (inst.arrMs - firstDep > maxTotal) continue;

        const carrier = graph.carriers.get(s.carrier)!;
        const isProtected = !ground && graph.isProtected(prevCarrier.code, carrier.code) && prevCarrier.mode === carrier.mode;
        const type: Connection['type'] = ground ? 'ground_transfer' : isProtected ? 'protected' : 'self_transfer';
        const requiredMin = ground ? minGap : isProtected ? node.mctProtected : node.mctSelfTransfer;
        const layoverMin = Math.round((inst.depMs - arrMs) / MIN);
        if (layoverMin < requiredMin) continue;

        const month = new Date(arrMs).getUTCMonth() + 1;
        const conn: Connection = {
          arriveAt: node.code,
          departFrom: next.code,
          country: node.country,
          type,
          layoverMin,
          requiredMin,
          bufferMin: layoverMin - requiredMin,
          groundTransferMin: groundMin,
          terminalComplexity: Math.max(node.terminalComplexity, next.terminalComplexity),
          weatherRisk: node.weatherRiskMonths.includes(month),
          requiresImmigration: type !== 'protected',
          requiresBagRecheck: type !== 'protected',
          overnight: layoverMin >= 360 && crossesLocalMidnight(arrMs, inst.depMs, node.utcOffset),
        };
        const step: Step = { inst, conn };
        const nextPath = [...path, step];
        if (toNode.metro === destMetro) {
          results.push(nextPath);
        } else {
          visitedMetros.add(toNode.metro);
          visit(toNode, inst.arrMs, nextPath, visitedMetros, firstDep);
          visitedMetros.delete(toNode.metro);
        }
      }
    }
  };

  for (const start of originNodes) {
    for (const inst of graph.departures(start.code, windowStart, windowEnd)) {
      if (!modes.has(inst.service.mode)) continue;
      const toNode = graph.node(inst.service.to);
      if (toNode.metro === origin.metro) continue;
      const path: Step[] = [{ inst }];
      if (toNode.metro === destMetro) {
        results.push(path);
        continue;
      }
      visit(toNode, inst.arrMs, path, new Set([origin.metro, toNode.metro]), inst.depMs);
    }
  }

  return results.map((p) => toItinerary(graph, p));
}

function toItinerary(graph: NetworkGraph, path: Step[]): Itinerary {
  const legs: Leg[] = path.map(({ inst }) => {
    const s = inst.service;
    const from = graph.node(s.from);
    const to = graph.node(s.to);
    const carrier = graph.carriers.get(s.carrier)!;
    return {
      carrier: s.carrier,
      carrierName: carrier.name,
      number: s.number,
      mode: s.mode,
      from: s.from,
      to: s.to,
      fromCountry: from.country,
      toCountry: to.country,
      depUtc: new Date(inst.depMs).toISOString(),
      arrUtc: new Date(inst.arrMs).toISOString(),
      depLocal: fmtLocal(inst.depMs, from.utcOffset),
      arrLocal: fmtLocal(inst.arrMs, to.utcOffset),
      durationMin: s.durationMin,
      fareUsd: inst.fareUsd,
      taxUsd: s.mode === 'flight' ? from.departureTaxUsd : 0,
      distanceKm: graph.distanceKm(s.from, s.to),
      carrierOtp: carrier.otp,
      delayStdMin: graph.delayStdMin(carrier),
      frequencyPerWeek: graph.frequencyPerWeek(s.from, s.to),
      fairness: graph.fairness(s.mode, s.from, s.to, inst.fareUsd),
    };
  });
  const connections = path.slice(1).map((s) => s.conn!);
  const base = legs.reduce((a, l) => a + l.fareUsd, 0);
  const taxes = legs.reduce((a, l) => a + l.taxUsd, 0);
  const fee = platformFee(base);
  const benchmark = legs.reduce((a, l) => a + l.fairness.benchmarkUsd, 0);
  const ratio = Math.round((base / benchmark) * 100) / 100;
  const id = createHash('sha1').update(legs.map((l) => `${l.number}@${l.depUtc}`).join('>')).digest('hex').slice(0, 12);
  const carriers = [...new Set(legs.map((l) => l.carrier))];

  return {
    id,
    legs,
    connections,
    modes: [...new Set(legs.map((l) => l.mode))],
    carriers,
    isVirtualInterline: connections.some((c) => c.type !== 'protected'),
    departureUtc: legs[0].depUtc,
    arrivalUtc: legs[legs.length - 1].arrUtc,
    totalDurationMin: Math.round((Date.parse(legs[legs.length - 1].arrUtc) - Date.parse(legs[0].depUtc)) / MIN),
    price: {
      baseFareUsd: base,
      taxesUsd: taxes,
      platformFeeUsd: fee,
      protectionPremiumUsd: 0,
      totalWithoutProtectionUsd: round2(base + taxes + fee),
      totalWithProtectionUsd: round2(base + taxes + fee),
    },
    fairness: { ratio, label: ratio < 0.85 ? 'good_value' : ratio > 1.35 ? 'above_benchmark' : 'fair' },
    tags: [],
  };
}

/** Removes itineraries that are worse on price, duration AND number of legs than another one. */
export function paretoFilter(its: Itinerary[]): Itinerary[] {
  const sorted = [...its].sort((a, b) => a.price.totalWithoutProtectionUsd - b.price.totalWithoutProtectionUsd);
  const keep: Itinerary[] = [];
  for (const it of sorted) {
    const dominated = keep.some(
      (k) =>
        k.price.totalWithoutProtectionUsd <= it.price.totalWithoutProtectionUsd &&
        k.totalDurationMin <= it.totalDurationMin &&
        k.legs.length <= it.legs.length &&
        k.connections.filter((c) => c.type !== 'protected').length <= it.connections.filter((c) => c.type !== 'protected').length,
    );
    if (!dominated) keep.push(it);
  }
  return keep;
}
