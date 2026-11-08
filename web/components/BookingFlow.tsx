'use client';

import { useEffect, useState } from 'react';
import { api, fmtMoney } from '../lib/api';
import type { Booking, Itinerary, Payment } from '../lib/types';
import { ShieldIcon } from './icons';
import { inline, type MoneyFn } from './money';

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <section className={`step ${done ? 'done' : ''}`}>
      <h3><span className="step-num">{done ? '✓' : n}</span>{title}</h3>
      <div className="step-body">{children}</div>
    </section>
  );
}

export default function BookingFlow({ itinerary, nationality, currency, money, onBack }: {
  itinerary: Itinerary; nationality: string; currency: string; money: MoneyFn; onBack: () => void;
}) {
  const [token, setToken] = useState<string | null>(() => store.get('token') || null);
  const [phone, setPhone] = useState(() => store.get('phone') ?? '+250788000001');
  const [otp, setOtp] = useState('');
  const [devCode, setDevCode] = useState('');
  const [pax, setPax] = useState({ firstName: '', lastName: '' });
  const [protection, setProtection] = useState(itinerary.price.protectionPremiumUsd > 0);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [methods, setMethods] = useState<Array<{ id: string; name: string }>>([]);
  const [method, setMethod] = useState('');
  const [payment, setPayment] = useState<Payment | null>(null);
  const [disruption, setDisruption] = useState<{ outcome: string; message: string } | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr('');
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  useEffect(() => {
    if (!token) return;
    api<{ methods: Array<{ id: string; name: string }> }>(`/api/payments/methods?country=${nationality}`, { token })
      .then((r) => { setMethods(r.methods); setMethod(r.methods[0]?.id ?? 'papss'); })
      .catch((e: Error) => {
        // Expired/invalid session: ask the user to sign in again.
        if (/sign in|unauthori/i.test(e.message)) { setToken(null); store.set('token', ''); }
      });
  }, [nationality, token]);

  useEffect(() => {
    if (!payment || !token || payment.status === 'failed' || payment.bookingConfirmed) return;
    const t = setTimeout(async () => {
      const p = await api<Payment>(`/api/payments/${payment.paymentId}`, { token });
      setPayment(p);
      if (p.bookingConfirmed && booking) setBooking(await api<Booking>(`/api/bookings/${booking.pnr}`, { token }));
    }, 1200);
    return () => clearTimeout(t);
  }, [payment, token, booking]);

  const total = money(protection ? itinerary.price.totalWithProtectionUsd : itinerary.price.totalWithoutProtectionUsd);
  const first = itinerary.legs[0];
  const last = itinerary.legs[itinerary.legs.length - 1];
  const ticketed = !!booking && booking.status !== 'PENDING_PAYMENT';

  return (
    <section className="card booking">
      <button type="button" className="btn-link" onClick={onBack}>← Back to results</button>
      <div className="booking-head">
        <div>
          <h2>{first.from} → {last.to}</h2>
          <p className="muted small">{first.depLocal} · {itinerary.legs.map((l) => l.number).join(' + ')}</p>
        </div>
        <div className="itin-price">
          <div className="amount">{total.main}</div>
          {total.alt && <div className="amount-alt">{total.alt}</div>}
        </div>
      </div>

      {itinerary.isVirtualInterline && (
        <label className={`protect ${protection ? 'on' : ''}`}>
          <input type="checkbox" checked={protection} disabled={!!booking} onChange={(e) => setProtection(e.target.checked)} />
          <ShieldIcon width={22} height={22} />
          <span>
            <b>Self-transfer protection · {money(itinerary.price.protectionPremiumUsd).main}</b>
            <span className="muted small">If a delay makes you miss a connection, we rebook you on the next service and pay for your hotel.</span>
          </span>
        </label>
      )}

      <Step n={1} title="Sign in with your phone" done={!!token}>
        {token ? <p className="muted small">Signed in as {phone}.</p> : (
          <>
            <div className="row">
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+250…" inputMode="tel" aria-label="Phone number" />
              <button type="button" className="btn" disabled={busy} onClick={() => run(async () => {
                const r = await api<{ devCode?: string }>('/api/auth/otp', { method: 'POST', body: JSON.stringify({ phone }) });
                setDevCode(r.devCode ?? ''); store.set('phone', phone);
              })}>Send code</button>
            </div>
            {devCode && <p className="hint">Dev mode: your code is <b>{devCode}</b> (production sends it by SMS).</p>}
            <div className="row">
              <input value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="6-digit code" inputMode="numeric" aria-label="Verification code" />
              <button type="button" className="btn primary" disabled={busy || otp.length !== 6} onClick={() => run(async () => {
                const r = await api<{ token: string }>('/api/auth/verify', { method: 'POST', body: JSON.stringify({ phone, code: otp }) });
                setToken(r.token); store.set('token', r.token);
              })}>Verify</button>
            </div>
          </>
        )}
      </Step>

      {token && (
        <Step n={2} title="Passenger (as on passport)" done={!!booking}>
          {booking ? <p className="muted small">{pax.firstName} {pax.lastName} · booking <b>{booking.pnr}</b> held for 30 min.</p> : (
            <>
              <div className="row">
                <input placeholder="First name" value={pax.firstName} onChange={(e) => setPax({ ...pax, firstName: e.target.value })} aria-label="First name" />
                <input placeholder="Last name" value={pax.lastName} onChange={(e) => setPax({ ...pax, lastName: e.target.value })} aria-label="Last name" />
              </div>
              <button type="button" className="btn primary" disabled={busy || !pax.firstName || !pax.lastName} onClick={() => run(async () => {
                const b = await api<Booking>('/api/bookings', { method: 'POST', token, body: JSON.stringify({ offerToken: itinerary.offerToken, addProtection: protection, passengers: [{ ...pax, nationality }], contact: { phone } }) });
                setBooking(b);
              })}>Hold seats · {total.main}</button>
            </>
          )}
        </Step>
      )}

      {booking && (
        <Step n={3} title={`Pay in ${currency}`} done={!!payment && payment.status === 'succeeded'}>
          {!payment ? (
            <>
              <div className="methods" role="radiogroup" aria-label="Payment method">
                {methods.map((m) => (
                  <label key={m.id} className={`method ${method === m.id ? 'active' : ''}`}>
                    <input type="radio" name="method" checked={method === m.id} onChange={() => setMethod(m.id)} />
                    <span>{m.name}</span>
                  </label>
                ))}
              </div>
              <p className="hint">Tip: a phone number ending in 0000 simulates an empty mobile wallet, which shows the automatic fallback to PAPSS.</p>
              <button type="button" className="btn primary" disabled={busy} onClick={() => run(async () => {
                const p = await api<Payment>('/api/payments', { method: 'POST', token, body: JSON.stringify({ pnr: booking.pnr, method, payer: { phone, country: nationality, currency } }) });
                setPayment(p);
              })}>Pay {inline(money(booking.amountUsd))}</button>
            </>
          ) : (
            <>
              <p>
                <b>{fmtMoney(payment.payerAmount, payment.payerCurrency)}</b> via {payment.rail} ({payment.mode}) —{' '}
                <span className={`pill status ${payment.status}`}>{payment.status === 'succeeded' ? 'received' : payment.status}</span>
              </p>
              {payment.status === 'pending' && <p className="muted small">{payment.instructions}</p>}
              {payment.attempts.filter((x) => !x.ok).map((x) => <p key={x.rail} className="hint">Fallback: {x.rail} failed ({x.error}).</p>)}
              <details className="settle">
                <summary>PAPSS settlement plan (no USD double conversion)</summary>
                <dl className="kv">
                  {payment.settlement.lines.map((l, i) => (
                    <div key={i}><dt>{l.beneficiary}<small>{l.purpose} · {l.route}</small></dt><dd>{fmtMoney(l.amount, l.currency)}</dd></div>
                  ))}
                </dl>
                <p className="muted small">Estimated saving vs routing through USD: {fmtMoney(payment.settlement.estimatedSavingsVsUsdRouting.amount, payment.settlement.estimatedSavingsVsUsdRouting.currency)}</p>
              </details>
            </>
          )}
        </Step>
      )}

      {booking && ticketed && (
        <Step n={4} title={`Booking ${booking.pnr}: ${booking.status.replace(/_/g, ' ').toLowerCase()}`} done>
          <ul className="segs">
            {booking.segments.map((s) => (
              <li key={s.idx} className={s.status.toLowerCase()}>
                <div><b>{s.number}</b> {s.from} → {s.to}{s.source === 'reaccommodation' && <span className="pill tag recommended">rebooked</span>}</div>
                <div className="muted small">{s.depUtc.slice(0, 16).replace('T', ' ')} UTC · {s.status.toLowerCase()}{s.ticketRef ? ` · ticket ${s.ticketRef}` : ''}</div>
              </li>
            ))}
          </ul>
          {itinerary.legs.length > 1 && booking.status === 'TICKETED' && (
            <button type="button" className="btn" disabled={busy} onClick={() => run(async () => {
              const r = await api<{ outcome: string; message: string; booking: Booking }>(`/api/bookings/${booking.pnr}/disruptions`, { method: 'POST', token, body: JSON.stringify({ legIndex: 0, delayMinutes: 240 }) });
              setDisruption(r); setBooking(r.booking);
            })}>Simulate a 4h delay on the first leg</button>
          )}
          {disruption && <div className={`alert ${disruption.outcome === 'rebooked' ? 'ok' : 'info'}`}>{disruption.message}</div>}
        </Step>
      )}
      {err && <div className="alert">{err}</div>}
    </section>
  );
}
