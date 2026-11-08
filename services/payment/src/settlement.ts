import { convert, crossRate, loadNetworkFromFiles, roundMoney } from '@pai/shared';

const network = loadNetworkFromFiles();
const nodeCurrency = new Map(network.nodes.map((n) => [n.code, n.currency]));
const carrierCurrency = new Map(network.carriers.map((c) => [c.code, nodeCurrency.get(c.hub) ?? 'USD']));

interface BookingLike {
  passengers: unknown[];
  protection: boolean;
  amountUsd: number;
  segments: Array<{ carrier: string; carrierName: string; fareUsd: number; taxUsd: number; status: string }>;
  offer: { price: { platformFeeUsd: number; protectionPremiumUsd: number } };
}

export interface SettlementLine {
  beneficiary: string;
  purpose: string;
  currency: string;
  amount: number;
  payerCurrencyAmount: number;
  directRate: number;
  route: string;
}

/**
 * PAPSS-style settlement plan: the payer's local currency is converted *directly*
 * into each carrier's home currency (e.g. RWF -> NGN) instead of RWF -> USD -> NGN.
 * Fares are filed in USD in this MVP, so USD is used only as a unit of account.
 */
export function settlementPlan(b: BookingLike, payerCurrency: string) {
  const n = b.passengers.length;
  const lines: SettlementLine[] = [];
  const byCarrier = new Map<string, { name: string; usd: number }>();
  for (const s of b.segments.filter((x) => x.status !== 'REPLACED')) {
    const cur = byCarrier.get(s.carrier) ?? { name: s.carrierName, usd: 0 };
    cur.usd += (s.fareUsd + s.taxUsd) * n;
    byCarrier.set(s.carrier, cur);
  }
  for (const [code, { name, usd }] of byCarrier) {
    const ccy = carrierCurrency.get(code) ?? 'USD';
    const payerAmt = convert(usd, 'USD', payerCurrency);
    lines.push({
      beneficiary: `${name} (${code})`,
      purpose: 'Ticket fare + taxes',
      currency: ccy,
      amount: roundMoney(payerAmt * crossRate(payerCurrency, ccy), ccy),
      payerCurrencyAmount: payerAmt,
      directRate: Number(crossRate(payerCurrency, ccy).toPrecision(6)),
      route: ccy === payerCurrency ? 'Domestic transfer' : `PAPSS direct ${payerCurrency}->${ccy} (no USD leg)`,
    });
  }
  const local = (usd: number, purpose: string) =>
    usd > 0 && lines.push({ beneficiary: 'Platform local collection account', purpose, currency: payerCurrency, amount: convert(usd, 'USD', payerCurrency), payerCurrencyAmount: convert(usd, 'USD', payerCurrency), directRate: 1, route: 'Retained locally' });
  local(b.offer.price.platformFeeUsd * n, 'Platform fee');
  if (b.protection) local(b.offer.price.protectionPremiumUsd * n, 'Protection reserve');
  const doubleConversionSavings = roundMoney(convert(b.amountUsd, 'USD', payerCurrency) * 0.03, payerCurrency);
  return {
    payerCurrency,
    payerTotal: convert(b.amountUsd, 'USD', payerCurrency),
    lines,
    estimatedSavingsVsUsdRouting: { amount: doubleConversionSavings, currency: payerCurrency, assumption: '~1.5% FX spread avoided on each of two USD conversions' },
  };
}
