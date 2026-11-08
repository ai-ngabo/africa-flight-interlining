import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Carrier, Mode, ScheduledService, TransitNode } from './types';

const here = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR ?? resolve(here, '../../../data');

export interface NetworkData {
  nodes: TransitNode[];
  carriers: Carrier[];
  services: ScheduledService[];
  interline: Array<[string, string]>;
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(resolve(DATA_DIR, file), 'utf8')) as T;
}

/** Parses the compact schedule format in data/services.txt. */
export function parseServices(text: string, carriers: Map<string, Carrier>): ScheduledService[] {
  const out: ScheduledService[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const parts = line.split(/\s+/);
    if (parts.length !== 8) throw new Error(`services.txt line ${i + 1}: expected 8 fields, got ${parts.length}`);
    const [carrier, number, from, to, dep, dur, days, fare] = parts;
    const c = carriers.get(carrier);
    if (!c) throw new Error(`services.txt line ${i + 1}: unknown carrier ${carrier}`);
    if (!/^\d{2}:\d{2}$/.test(dep)) throw new Error(`services.txt line ${i + 1}: bad time ${dep}`);
    out.push({
      carrier,
      number: `${carrier}${number}`,
      from,
      to,
      dep,
      durationMin: Number(dur),
      days: days.split('').map(Number),
      fareUsd: Number(fare),
      mode: c.mode as Mode,
    });
  });
  return out;
}

export function loadNetworkFromFiles(): NetworkData {
  const nodes = readJson<{ nodes: TransitNode[] }>('nodes.json').nodes;
  const carrierFile = readJson<{ carriers: Carrier[]; interlineAgreements: Array<{ carriers: [string, string] }> }>('carriers.json');
  const carriers = carrierFile.carriers;
  const carrierMap = new Map(carriers.map((c) => [c.code, c]));
  const services = parseServices(readFileSync(resolve(DATA_DIR, 'services.txt'), 'utf8'), carrierMap);
  const nodeCodes = new Set(nodes.map((n) => n.code));
  for (const s of services) {
    if (!nodeCodes.has(s.from) || !nodeCodes.has(s.to)) throw new Error(`Service ${s.number} references unknown node ${s.from}/${s.to}`);
  }
  return { nodes, carriers, services, interline: carrierFile.interlineAgreements.map((a) => a.carriers) };
}
