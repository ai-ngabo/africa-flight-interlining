import { haversineKm, type Carrier, type FairnessInfo, type NetworkData, type ScheduledService, type TransitNode } from '@pai/shared';

/** A concrete dated departure of a weekly ScheduledService. */
export interface Instance {
  service: ScheduledService;
  depMs: number;
  arrMs: number;
  fareUsd: number;
  localDate: string;
}

const DAY = 86_400_000;

/** Deterministic pseudo-random in [0,1) so prices are stable between identical searches. */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

export function isoWeekday(dateMs: number): number {
  const d = new Date(dateMs).getUTCDay();
  return d === 0 ? 7 : d;
}

export function parseDate(date: string): number {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Invalid date ${date}, expected YYYY-MM-DD`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function fmtLocal(ms: number, utcOffset: number): string {
  return new Date(ms + utcOffset * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
}

const FLIGHT_BANDS = [600, 1500, 3000, Infinity];

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * In-memory graph index built from either Neo4j or the seed files. Nodes are
 * airports/bus terminals, edges are scheduled services; metro areas link nodes
 * that can be connected by a ground transfer.
 */
export class NetworkGraph {
  readonly nodes = new Map<string, TransitNode>();
  readonly carriers = new Map<string, Carrier>();
  readonly byFrom = new Map<string, ScheduledService[]>();
  readonly metro = new Map<string, TransitNode[]>();
  private readonly interline = new Set<string>();
  private readonly frequency = new Map<string, number>();
  private readonly benchmarks = new Map<string, number>();

  constructor(readonly data: NetworkData) {
    for (const n of data.nodes) {
      this.nodes.set(n.code, n);
      const list = this.metro.get(n.metro) ?? [];
      list.push(n);
      this.metro.set(n.metro, list);
    }
    for (const c of data.carriers) this.carriers.set(c.code, c);
    for (const [a, b] of data.interline) {
      this.interline.add(`${a}|${b}`);
      this.interline.add(`${b}|${a}`);
    }
    for (const s of data.services) {
      const list = this.byFrom.get(s.from) ?? [];
      list.push(s);
      this.byFrom.set(s.from, list);
      const key = `${s.from}|${s.to}`;
      this.frequency.set(key, (this.frequency.get(key) ?? 0) + s.days.length);
    }
    this.buildBenchmarks();
  }

  node(code: string): TransitNode {
    const n = this.nodes.get(code);
    if (!n) throw new Error(`Unknown node ${code}`);
    return n;
  }

  distanceKm(from: string, to: string): number {
    const a = this.node(from);
    const b = this.node(to);
    return Math.round(haversineKm(a.lat, a.lon, b.lat, b.lon));
  }

  /** Weekly departures on this city pair, any carrier — a proxy for how easy re-accommodation is. */
  frequencyPerWeek(from: string, to: string): number {
    return this.frequency.get(`${from}|${to}`) ?? 0;
  }

  /** True when the two carriers' tickets are protected end to end (same carrier or interline agreement). */
  isProtected(a: string, b: string): boolean {
    return a === b || this.interline.has(`${a}|${b}`);
  }

  delayStdMin(carrier: Carrier): number {
    return Math.round((carrier.mode === 'bus' ? 25 : 12) + (1 - carrier.otp) * 110);
  }

  private bandKey(mode: string, km: number): string {
    if (mode === 'bus') return 'bus';
    return `flight:${FLIGHT_BANDS.findIndex((b) => km < b)}`;
  }

  private buildBenchmarks() {
    const perBand = new Map<string, number[]>();
    for (const s of this.data.services) {
      const km = this.distanceKm(s.from, s.to);
      if (km <= 0) continue;
      const key = this.bandKey(s.mode, km);
      const list = perBand.get(key) ?? [];
      list.push(s.fareUsd / km);
      perBand.set(key, list);
    }
    for (const [k, v] of perBand) this.benchmarks.set(k, median(v));
  }

  /** Fair Price Index: compare a fare with the network's median fare-per-km for similar distances. */
  fairness(mode: string, from: string, to: string, fareUsd: number): FairnessInfo {
    const km = Math.max(1, this.distanceKm(from, to));
    const perKm = this.benchmarks.get(this.bandKey(mode, km)) ?? fareUsd / km;
    const benchmarkUsd = Math.round(perKm * km);
    const ratio = Math.round((fareUsd / benchmarkUsd) * 100) / 100;
    const label = ratio < 0.85 ? 'good_value' : ratio > 1.35 ? 'above_benchmark' : 'fair';
    return { usdPerKm: Math.round((fareUsd / km) * 1000) / 1000, benchmarkUsd, ratio, label };
  }

  /** Dated departures from `from` with UTC departure in [startMs, endMs). */
  departures(from: string, startMs: number, endMs: number): Instance[] {
    const services = this.byFrom.get(from) ?? [];
    const node = this.node(from);
    const out: Instance[] = [];
    const firstDay = Math.floor((startMs + node.utcOffset * 3600_000) / DAY) * DAY - DAY;
    for (let day = firstDay; day < endMs + DAY; day += DAY) {
      const wd = isoWeekday(day);
      const localDate = new Date(day).toISOString().slice(0, 10);
      for (const s of services) {
        if (!s.days.includes(wd)) continue;
        const [hh, mm] = s.dep.split(':').map(Number);
        const depMs = day + (hh * 60 + mm) * 60_000 - node.utcOffset * 3600_000;
        if (depMs < startMs || depMs >= endMs) continue;
        // Demand-based variation (+/-) – deterministic per flight and date.
        const mult = 0.88 + hash01(`${s.number}|${localDate}`) * 0.32 + (wd === 5 || wd === 7 ? 0.05 : 0);
        out.push({ service: s, depMs, arrMs: depMs + s.durationMin * 60_000, fareUsd: Math.round(s.fareUsd * mult), localDate });
      }
    }
    return out.sort((a, b) => a.depMs - b.depMs);
  }
}
