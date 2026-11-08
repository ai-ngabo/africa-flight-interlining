/**
 * Indicative FX reference rates (units of currency per 1 USD). Used only as a
 * reference to compute direct cross rates (e.g. RWF -> NGN); settlement itself
 * is modelled as a direct local-to-local PAPSS transfer with no USD leg.
 * Set FX_LIVE=1 to refresh from the free, key-less https://open.er-api.com feed.
 */
const SEED_RATES: Record<string, number> = {
  USD: 1, RWF: 1450, UGX: 3650, KES: 129, TZS: 2450, ETB: 152, BIF: 2950, CDF: 2850,
  ZAR: 17.6, NAD: 17.6, BWP: 13.6, ZMW: 23, ZWG: 26.8, MWK: 1735, MZN: 63.9, MUR: 45.5, SCR: 14.2,
  NGN: 1480, GHS: 11.2, XOF: 562, XAF: 562, MAD: 9.2, EGP: 48.5, EUR: 0.857,
};

let rates: Record<string, number> = { ...SEED_RATES };
let source: 'seed' | 'live' = 'seed';
let fetchedAt = 0;

export async function refreshRates(): Promise<void> {
  if (process.env.FX_LIVE !== '1') return;
  if (Date.now() - fetchedAt < 12 * 3600_000) return;
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(4000) });
    const json = (await res.json()) as { result: string; rates: Record<string, number> };
    if (json.result === 'success') {
      rates = { ...SEED_RATES, ...json.rates };
      source = 'live';
      fetchedAt = Date.now();
    }
  } catch {
    /* keep previous rates: resilience over freshness */
  }
}

export function fxInfo() {
  return { source, fetchedAt: fetchedAt ? new Date(fetchedAt).toISOString() : null, currencies: Object.keys(rates).sort() };
}

export function hasCurrency(c: string): boolean {
  return c in rates;
}

/** Direct cross rate: how many `to` units per 1 `from` unit. */
export function crossRate(from: string, to: string): number {
  const f = rates[from];
  const t = rates[to];
  if (!f || !t) throw new Error(`Unsupported currency pair ${from}/${to}`);
  return t / f;
}

export function convert(amount: number, from: string, to: string): number {
  return roundMoney(amount * crossRate(from, to), to);
}

const ZERO_DECIMAL = new Set(['RWF', 'UGX', 'BIF', 'XOF', 'XAF', 'TZS', 'CDF', 'MWK']);

export function roundMoney(amount: number, currency: string): number {
  return ZERO_DECIMAL.has(currency) ? Math.round(amount) : Math.round(amount * 100) / 100;
}
