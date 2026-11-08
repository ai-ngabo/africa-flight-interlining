import { randomBytes, randomUUID } from 'node:crypto';
import { round2, verifyOffer, type Itinerary } from '@pai/shared';
import type { Booking, LedgerEntry, Passenger, Segment } from './model';
import type { BookingRepo } from './repo';

const HOLD_MIN = 30;
const HOTEL_USD = 75;
const PNR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class BookingError extends Error {
  constructor(message: string, public status = 400, public code = 'booking_error') {
    super(message);
  }
}

const cents = (usd: number) => Math.round(usd * 100);
const now = () => new Date().toISOString();

function newPnr(): string {
  const bytes = randomBytes(6);
  return [...bytes].map((b) => PNR_ALPHABET[b % PNR_ALPHABET.length]).join('');
}

/** Simulated carrier connector. Production: NDC / GDS / carrier direct APIs per airline or coach operator. */
function issueTicket(carrier: string): string {
  return `${carrier}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

export type SearchFn = (q: { origin: string; destination: string; earliestDepartureUtc: string; date: string }) => Promise<Itinerary[]>;

export interface CreateInput {
  offerToken: string;
  addProtection: boolean;
  passengers: Passenger[];
  contact: { phone: string; email?: string };
}

export class BookingService {
  constructor(private repo: BookingRepo, private searchFn: SearchFn) {}

  async create(userId: string, input: CreateInput): Promise<Booking> {
    let offer;
    try {
      offer = verifyOffer(input.offerToken);
    } catch (err) {
      throw new BookingError((err as Error).message, 409, 'offer_invalid');
    }
    const protection = input.addProtection && offer.price.protectionPremiumUsd > 0;
    const unit = protection ? offer.price.totalWithProtectionUsd : offer.price.totalWithoutProtectionUsd;
    const ts = now();
    const booking: Booking = {
      pnr: newPnr(),
      userId,
      status: 'PENDING_PAYMENT',
      contact: input.contact,
      passengers: input.passengers,
      offer,
      protection,
      unitPriceUsd: unit,
      amountUsd: round2(unit * input.passengers.length),
      segments: offer.legs.map((l, idx) => ({ ...l, idx, status: 'HELD', source: 'original' })),
      events: [{ at: ts, type: 'CREATED', data: { protection, passengers: input.passengers.length } }],
      holdExpiresAt: new Date(Date.now() + HOLD_MIN * 60_000).toISOString(),
      createdAt: ts,
      updatedAt: ts,
      version: 1,
    };
    await this.repo.create(booking);
    return booking;
  }

  async get(pnr: string): Promise<Booking> {
    const b = await this.repo.get(pnr);
    if (!b) throw new BookingError(`Booking ${pnr} not found`, 404, 'not_found');
    if (b.status === 'PENDING_PAYMENT' && new Date(b.holdExpiresAt) < new Date()) {
      b.status = 'EXPIRED';
      b.events.push({ at: now(), type: 'HOLD_EXPIRED' });
      await this.repo.save(b);
    }
    return b;
  }

  /** Called by the payment service once funds are confirmed. Idempotent per paymentId. */
  async confirmPayment(pnr: string, p: { paymentId: string; rail: string; payerCurrency: string; payerAmount: number; amountUsd: number }): Promise<Booking> {
    const b = await this.get(pnr);
    if (b.payment?.paymentId === p.paymentId) return b;
    if (b.status !== 'PENDING_PAYMENT') throw new BookingError(`Booking is ${b.status}, cannot confirm payment`, 409, 'invalid_state');
    if (cents(p.amountUsd) !== cents(b.amountUsd)) throw new BookingError('Paid amount does not match booking amount', 409, 'amount_mismatch');

    const n = b.passengers.length;
    const txId = randomUUID();
    const ledger: LedgerEntry[] = [{ txId, pnr, account: `cash:${p.rail}`, debitCents: cents(b.amountUsd), creditCents: 0, memo: `Payment ${p.paymentId} (${p.payerAmount} ${p.payerCurrency})` }];
    const credit = (account: string, usd: number, memo: string) => usd > 0 && ledger.push({ txId, pnr, account, debitCents: 0, creditCents: cents(usd), memo });
    for (const s of b.segments) credit(`payable:carrier:${s.carrier}`, (s.fareUsd + s.taxUsd) * n, `${s.number} ${s.from}-${s.to} x${n}`);
    credit('revenue:platform_fee', b.offer.price.platformFeeUsd * n, 'Platform fee (capped 3%)');
    if (b.protection) credit('reserve:protection', b.offer.price.protectionPremiumUsd * n, 'Self-transfer protection premium');
    // Absorb rounding so the transaction always balances to the cent.
    const diff = ledger.reduce((a, e) => a + e.debitCents - e.creditCents, 0);
    if (diff > 0) credit('revenue:rounding', diff / 100, 'Rounding');
    if (diff < 0) ledger.push({ txId, pnr, account: 'revenue:rounding', debitCents: -diff, creditCents: 0, memo: 'Rounding' });

    for (const s of b.segments) {
      s.status = 'TICKETED';
      s.ticketRef = issueTicket(s.carrier);
    }
    b.status = 'TICKETED';
    b.payment = { paymentId: p.paymentId, rail: p.rail, payerCurrency: p.payerCurrency, payerAmount: p.payerAmount, confirmedAt: now() };
    b.events.push({ at: now(), type: 'PAID_AND_TICKETED', data: { paymentId: p.paymentId, rail: p.rail, tickets: b.segments.map((s) => s.ticketRef) } });
    await this.repo.save(b, ledger);
    return b;
  }

  /**
   * Guaranteed Protection Wrapper: a delay on leg `legIndex` is reported (in
   * production, from a flight-status feed). If it breaks the next connection the
   * platform rebooks the rest of the journey and pays for accommodation.
   */
  async reportDisruption(pnr: string, legIndex: number, delayMinutes: number) {
    const b = await this.get(pnr);
    if (b.status !== 'TICKETED' && b.status !== 'DISRUPTED_REBOOKED') throw new BookingError(`Booking is ${b.status}`, 409, 'invalid_state');
    const active = b.segments.filter((s) => s.status === 'TICKETED').sort((x, y) => Date.parse(x.depUtc) - Date.parse(y.depUtc));
    const seg = active.find((s) => s.idx === legIndex);
    if (!seg) throw new BookingError(`No active segment with index ${legIndex}`, 404, 'not_found');
    const pos = active.indexOf(seg);
    const next = active[pos + 1];
    const newArr = Date.parse(seg.arrUtc) + delayMinutes * 60_000;
    b.events.push({ at: now(), type: 'DELAY_REPORTED', data: { segment: seg.number, delayMinutes } });

    if (!next) {
      await this.repo.save(b);
      return { booking: b, outcome: 'final_leg_delayed', message: 'Final leg delayed; no onward connection affected.' };
    }
    const conn = b.offer.connections.find((c) => c.arriveAt === seg.to) ?? { type: 'self_transfer', requiredMin: 150 };
    const gapMin = (Date.parse(next.depUtc) - newArr) / 60_000;
    if (gapMin >= conn.requiredMin) {
      await this.repo.save(b);
      return { booking: b, outcome: 'connection_safe', message: `Connection still feasible (${Math.round(gapMin)} min vs ${conn.requiredMin} required).` };
    }
    if (conn.type === 'protected') {
      b.events.push({ at: now(), type: 'CARRIER_PROTECTED_MISCONNECT', data: { at: seg.to } });
      await this.repo.save(b);
      return { booking: b, outcome: 'carrier_reaccommodation', message: `Protected connection at ${seg.to}: ${next.carrierName} is responsible for rebooking.` };
    }

    const remaining = active.slice(pos + 1);
    const earliest = new Date(newArr + conn.requiredMin * 60_000).toISOString();
    const alternatives = await this.searchFn({ origin: seg.to, destination: b.offer.destination, earliestDepartureUtc: earliest, date: earliest.slice(0, 10) });
    // Earliest arrival, but each extra connection costs 3h (and self-transfers 1h more) so we
    // don't re-accommodate onto a fragile 3-leg routing to save a few minutes.
    const cost = (it: Itinerary) => Date.parse(it.arrivalUtc) + it.connections.reduce((a, c) => a + (c.type === 'protected' ? 3 : 4) * 3600_000, 0);
    const best = [...alternatives].sort((x, y) => cost(x) - cost(y))[0];

    if (!b.protection) {
      for (const s of remaining) s.status = 'MISSED';
      b.events.push({ at: now(), type: 'MISSED_UNPROTECTED', data: { at: seg.to } });
      await this.repo.save(b);
      return { booking: b, outcome: 'missed_unprotected', message: 'Connection missed. Protection was not purchased; here are paid alternatives.', alternatives: alternatives.slice(0, 3) };
    }
    if (!best) {
      b.events.push({ at: now(), type: 'REBOOKING_PENDING_AGENT', data: { at: seg.to } });
      await this.repo.save(b);
      return { booking: b, outcome: 'manual_handling', message: 'No automatic alternative within 36h; a support agent will rebook (refund guaranteed).' };
    }

    const n = b.passengers.length;
    for (const s of remaining) s.status = 'REPLACED';
    let idx = Math.max(...b.segments.map((s) => s.idx)) + 1;
    const newSegs: Segment[] = best.legs.map((l) => ({
      idx: idx++, carrier: l.carrier, carrierName: l.carrierName, number: l.number, mode: l.mode, from: l.from, to: l.to,
      depUtc: l.depUtc, arrUtc: l.arrUtc, fareUsd: l.fareUsd, taxUsd: l.taxUsd, status: 'TICKETED', ticketRef: issueTicket(l.carrier), source: 'reaccommodation',
    }));
    b.segments.push(...newSegs);
    const waitMin = (Date.parse(best.departureUtc) - newArr) / 60_000;
    const hotel = waitMin > 360 || best.connections.some((c) => c.overnight) ? HOTEL_USD * n : 0;

    const txId = randomUUID();
    const ledger: LedgerEntry[] = [];
    let total = 0;
    for (const s of newSegs) {
      const c = cents((s.fareUsd + s.taxUsd) * n);
      total += c;
      ledger.push({ txId, pnr, account: `payable:carrier:${s.carrier}`, debitCents: 0, creditCents: c, memo: `Re-accommodation ${s.number} ${s.from}-${s.to}` });
    }
    if (hotel) {
      total += cents(hotel);
      ledger.push({ txId, pnr, account: 'payable:hotel', debitCents: 0, creditCents: cents(hotel), memo: `Accommodation at ${seg.to}` });
    }
    ledger.unshift({ txId, pnr, account: 'expense:protection_claims', debitCents: total, creditCents: 0, memo: `Missed self-transfer at ${seg.to}` });

    b.status = 'DISRUPTED_REBOOKED';
    b.events.push({ at: now(), type: 'REBOOKED_UNDER_PROTECTION', data: { at: seg.to, newSegments: newSegs.map((s) => s.number), hotelUsd: hotel, costUsd: total / 100 } });
    await this.repo.save(b, ledger);
    return { booking: b, outcome: 'rebooked', message: `Rebooked on ${newSegs.map((s) => s.number).join(' + ')}${hotel ? ' with hotel covered' : ''} at no cost to you.`, costUsd: total / 100, hotelUsd: hotel };
  }
}
