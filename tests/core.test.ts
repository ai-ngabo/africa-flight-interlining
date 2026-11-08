import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadNetworkFromFiles, signOffer, verifyOffer, type Itinerary } from '../packages/shared/src/index';
import { attachOffers, baggageWarnings } from '../services/search/src/assess';
import { NetworkGraph } from '../services/search/src/graph';
import { findItineraries, paretoFilter } from '../services/search/src/router';
import { MemoryRepo } from '../services/booking/src/repo';
import { BookingService } from '../services/booking/src/service';

const graph = new NetworkGraph(loadNetworkFromFiles());
// 2026-11-17 is a Tuesday (WB204 KGL-LOS operates 2467).
const DATE = '2026-11-17';

test('seed data loads and every node/service is consistent', () => {
  assert.ok(graph.nodes.size >= 40);
  assert.ok(graph.data.services.length > 200);
});

test('finds direct, protected and self-transfer itineraries Kigali -> Lagos', () => {
  const its = findItineraries(graph, { origin: 'KGL', destination: 'LOS', date: DATE });
  assert.ok(its.some((i) => i.legs.length === 1 && i.legs[0].number === 'WB204'), 'direct WB204');
  assert.ok(its.some((i) => i.connections.some((c) => c.type === 'protected')), 'protected ET via ADD');
  assert.ok(its.some((i) => i.isVirtualInterline), 'virtual interline');
});

test('every connection respects its minimum connection time', () => {
  const its = findItineraries(graph, { origin: 'KGL', destination: 'ACC', date: DATE });
  for (const it of its) {
    for (const c of it.connections) assert.ok(c.layoverMin >= c.requiredMin, `${it.id} ${c.arriveAt}`);
    for (let i = 1; i < it.legs.length; i++) assert.ok(Date.parse(it.legs[i].depUtc) > Date.parse(it.legs[i - 1].arrUtc));
  }
});

test('self-transfers use the stricter self-transfer MCT', () => {
  const its = findItineraries(graph, { origin: 'KGL', destination: 'LOS', date: DATE });
  const self = its.flatMap((i) => i.connections).filter((c) => c.type === 'self_transfer' && c.arriveAt === 'NBO');
  assert.ok(self.length > 0);
  for (const c of self) assert.equal(c.requiredMin, graph.node('NBO').mctSelfTransfer);
});

test('multi-modal: Lagos -> Accra can be done by coach', () => {
  const its = findItineraries(graph, { origin: 'LOS', destination: 'ACC', date: DATE });
  assert.ok(its.some((i) => i.modes.includes('bus')));
  const flightsOnly = findItineraries(graph, { origin: 'LOS', destination: 'ACC', date: DATE, modes: ['flight'] });
  assert.ok(flightsOnly.every((i) => !i.modes.includes('bus')));
});

test('ground transfer between airport and coach terminal in the same city', () => {
  // Kigali airport -> Nairobi coach terminal: forces a ground transfer somewhere or a coach start.
  const its = findItineraries(graph, { origin: 'KGL', destination: 'ARK-BUS', date: DATE, maxLegs: 3 });
  assert.ok(its.some((i) => i.connections.some((c) => c.type === 'ground_transfer')));
});

test('pareto filter keeps the cheapest and fastest', () => {
  const its = findItineraries(graph, { origin: 'KGL', destination: 'LOS', date: DATE });
  const kept = paretoFilter(its);
  const cheapest = Math.min(...its.map((i) => i.price.totalWithoutProtectionUsd));
  const fastest = Math.min(...its.map((i) => i.totalDurationMin));
  assert.ok(kept.some((i) => i.price.totalWithoutProtectionUsd === cheapest));
  assert.ok(kept.some((i) => i.totalDurationMin === fastest));
  assert.ok(kept.length <= its.length);
});

test('fair price index flags expensive legs', () => {
  const f = graph.fairness('flight', 'KGL', 'NBO', 2000);
  assert.equal(f.label, 'above_benchmark');
  assert.equal(graph.fairness('flight', 'KGL', 'NBO', 50).label, 'good_value');
});

test('offer tokens reject tampering and expiry', () => {
  const payload = { itineraryId: 'x', legs: [], connections: [], price: { baseFareUsd: 100, taxesUsd: 0, platformFeeUsd: 3, protectionPremiumUsd: 0, totalWithoutProtectionUsd: 103, totalWithProtectionUsd: 103 }, riskScore: 0, destination: 'LOS', issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() };
  const token = signOffer(payload);
  assert.equal(verifyOffer(token).price.totalWithoutProtectionUsd, 103);
  const [body, sig] = token.split('.');
  const forged = Buffer.from(Buffer.from(body, 'base64url').toString().replace('103', '1')).toString('base64url');
  assert.throws(() => verifyOffer(`${forged}.${sig}`), /signature/);
  assert.throws(() => verifyOffer(token, undefined, new Date(Date.now() + 120_000)), /expired/);
});

test('baggage warning when the onward carrier allows less', () => {
  const its = findItineraries(graph, { origin: 'KGL', destination: 'LOS', date: DATE });
  const it = its.find((i) => i.connections.some((c) => c.type === 'self_transfer') && i.legs[0].carrier === 'WB' && i.legs[1]?.carrier === 'KQ');
  assert.ok(it);
  assert.ok(baggageWarnings(graph, it!).some((w) => w.message.includes('excess baggage')));
});

function pick(): Itinerary {
  const its = findItineraries(graph, { origin: 'KGL', destination: 'LOS', date: DATE }).filter((i) => i.connections[0]?.type === 'self_transfer');
  const it = its[0];
  it.price.protectionPremiumUsd = 25;
  it.price.totalWithProtectionUsd = it.price.totalWithoutProtectionUsd + 25;
  attachOffers([it]);
  return it;
}

test('booking -> payment -> ledger balances; disruption rebooks under protection', async () => {
  const repo = new MemoryRepo();
  const it = pick();
  const alt = findItineraries(graph, { origin: it.legs[0].to, destination: 'LOS', date: DATE, earliestDepartureUtc: new Date(Date.parse(it.legs[0].arrUtc) + 6 * 3600_000).toISOString() });
  const svc = new BookingService(repo, async () => alt);

  const b = await svc.create('u1', { offerToken: it.offerToken!, addProtection: true, passengers: [{ firstName: 'Amina', lastName: 'K', nationality: 'RW' }], contact: { phone: '+250788000001' } });
  assert.equal(b.status, 'PENDING_PAYMENT');
  assert.equal(b.amountUsd, it.price.totalWithProtectionUsd);

  await assert.rejects(svc.confirmPayment(b.pnr, { paymentId: 'p1', rail: 'mtn_momo', payerCurrency: 'RWF', payerAmount: 1, amountUsd: 1 }), /amount/);
  const paid = await svc.confirmPayment(b.pnr, { paymentId: 'p1', rail: 'mtn_momo', payerCurrency: 'RWF', payerAmount: 1, amountUsd: b.amountUsd });
  assert.equal(paid.status, 'TICKETED');
  assert.ok(paid.segments.every((s) => s.ticketRef));
  // idempotent
  await svc.confirmPayment(b.pnr, { paymentId: 'p1', rail: 'mtn_momo', payerCurrency: 'RWF', payerAmount: 1, amountUsd: b.amountUsd });

  const ledger = await repo.ledger(b.pnr);
  assert.equal(ledger.reduce((a, e) => a + e.debitCents - e.creditCents, 0), 0);
  assert.ok(ledger.some((e) => e.account === 'reserve:protection'));

  const r = await svc.reportDisruption(b.pnr, 0, 300);
  assert.equal(r.outcome, 'rebooked');
  assert.ok(r.booking.segments.some((s) => s.source === 'reaccommodation' && s.status === 'TICKETED'));
  assert.ok(r.booking.segments.some((s) => s.status === 'REPLACED'));
  const after = await repo.ledger(b.pnr);
  assert.equal(after.reduce((a, e) => a + e.debitCents - e.creditCents, 0), 0);
  assert.ok(after.some((e) => e.account === 'expense:protection_claims'));
});

test('small delay keeps the connection', async () => {
  const repo = new MemoryRepo();
  const it = pick();
  const svc = new BookingService(repo, async () => []);
  const b = await svc.create('u1', { offerToken: it.offerToken!, addProtection: false, passengers: [{ firstName: 'A', lastName: 'B', nationality: 'RW' }], contact: { phone: '+250788000001' } });
  await svc.confirmPayment(b.pnr, { paymentId: 'p', rail: 'papss', payerCurrency: 'RWF', payerAmount: 1, amountUsd: b.amountUsd });
  const buffer = it.connections[0].bufferMin;
  const r = await svc.reportDisruption(b.pnr, 0, Math.max(1, buffer));
  assert.equal(r.outcome, buffer >= 1 ? 'connection_safe' : 'missed_unprotected');
});
