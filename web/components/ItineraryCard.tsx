'use client';

import { useState } from 'react';
import { COUNTRIES, fmtDur } from '../lib/api';
import type { Itinerary } from '../lib/types';
import { BusIcon, PlaneIcon, ShieldIcon } from './icons';
import type { MoneyFn } from './money';

const CONN_LABEL = { protected: 'Protected connection', self_transfer: 'Self-transfer', ground_transfer: 'Ground transfer' } as const;
export const REQ_LABEL: Record<string, string> = {
  none: 'No visa (citizen)', visa_free: 'Visa-free', eta: 'Travel authorisation (ETA)', visa_on_arrival: 'Visa on arrival',
  evisa: 'e-Visa needed', visa_required: 'Visa required', check_required: 'Check rules', airside_transit: 'Airside transit',
};
const FAIR_LABEL: Record<string, string> = { good_value: 'Below fair benchmark', fair: 'Fair price', above_benchmark: 'Above fair benchmark' };

export function RiskMeter({ score, label }: { score: number; label: string }) {
  return (
    <span className={`pill risk ${label}`} title="Probability of missing at least one connection">
      <span className="meter"><span style={{ width: `${Math.min(100, Math.max(4, score * 100))}%` }} /></span>
      {Math.round(score * 100)}% miss risk
    </span>
  );
}

export default function ItineraryCard({ it, money, onBook }: { it: Itinerary; money: MoneyFn; onBook: () => void }) {
  const [open, setOpen] = useState(false);
  const a = it.assessment;
  const first = it.legs[0];
  const last = it.legs[it.legs.length - 1];
  const nextDay = last.arrLocal.slice(0, 10) !== first.depLocal.slice(0, 10);
  const total = money(it.price.totalWithoutProtectionUsd);
  const stops = it.legs.length - 1;

  return (
    <article className="card itin">
      <header className="itin-top">
        <div className="itin-when">
          <div className="times">
            {first.depLocal.slice(11)} <span className="arrow">→</span> {last.arrLocal.slice(11)}
            {nextDay && <sup className="plus-day">+{Math.round((Date.parse(last.arrLocal.slice(0, 10)) - Date.parse(first.depLocal.slice(0, 10))) / 86400000)}</sup>}
          </div>
          <div className="itin-sub">
            <span>{fmtDur(it.totalDurationMin)}</span>
            <span>{stops === 0 ? 'Direct' : `${stops} stop${stops > 1 ? 's' : ''}`}</span>
            <span>{[...new Set(it.legs.map((l) => l.carrierName))].join(' + ')}</span>
          </div>
        </div>
        <div className="itin-price">
          <div className="amount">{total.main}</div>
          {total.alt && <div className="amount-alt">{total.alt}</div>}
          <span className={`pill fair ${it.fairness.label}`}>{FAIR_LABEL[it.fairness.label] ?? 'Fair price'} · {it.fairness.ratio}×</span>
        </div>
      </header>

      <div className="chips">
        {/* fairness is already shown next to the price, so skip those tags here */}
        {it.tags.filter((t) => t !== 'good_value' && t !== 'above_fair_benchmark').map((t) => <span key={t} className={`pill tag ${t}`}>{t.replace(/_/g, ' ')}</span>)}
        {a && it.connections.length > 0 && <RiskMeter score={a.riskScore} label={a.riskLabel} />}
        {a && a.travelDocStatus !== 'unknown' && (
          <span className={`pill doc ${a.travelDocStatus}`}>
            {a.travelDocStatus === 'ok' ? 'No visa needed' : a.travelDocStatus === 'visa_required' ? 'Visa required' : 'Travel docs needed'}
          </span>
        )}
      </div>

      <ol className="timeline">
        {it.legs.map((l, i) => {
          const c = it.connections[i];
          return (
            <li key={l.number + l.depUtc}>
              <div className="tl-leg">
                <span className={`tl-icon ${l.mode}`}>{l.mode === 'bus' ? <BusIcon width={15} height={15} /> : <PlaneIcon width={15} height={15} />}</span>
                <div className="tl-body">
                  <div className="tl-route">
                    <span><b>{l.from}</b> {l.depLocal.slice(11)}</span>
                    <span className="arrow">→</span>
                    <span><b>{l.to}</b> {l.arrLocal.slice(11)}</span>
                  </div>
                  <div className="tl-meta">
                    <span>{l.mode === 'bus' ? 'Coach' : 'Flight'}</span>
                    <span>{l.carrierName} {l.number}</span>
                    <span>{fmtDur(l.durationMin)}</span>
                    <span>{l.distanceKm.toLocaleString()} km</span>
                  </div>
                </div>
              </div>
              {c && (
                <div className={`tl-conn ${c.type}`}>
                  <strong>{CONN_LABEL[c.type]}</strong> at {c.arriveAt}{c.departFrom !== c.arriveAt ? ` → ${c.departFrom}` : ''}
                  <span className="tl-conn-detail">
                    {fmtDur(c.layoverMin)} layover · needs {fmtDur(c.requiredMin)}
                    {c.overnight && ' · overnight'}
                    {a && ` · ${Math.round(a.connectionRisks[i] * 100)}% risk`}
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {open && (
        <div className="itin-details">
          <section>
            <h4>Price breakdown</h4>
            <dl className="kv">
              {it.legs.map((l) => {
                const fare = money(l.fareUsd);
                return (
                  <div key={l.number + l.depUtc}>
                    <dt>{l.number} fare<small>Fair benchmark {money(l.fairness.benchmarkUsd).main}</small></dt>
                    <dd>{fare.main}{fare.alt && <small>{fare.alt}</small>}</dd>
                  </div>
                );
              })}
              <div><dt>Airport taxes &amp; charges</dt><dd>{money(it.price.taxesUsd).main}</dd></div>
              <div><dt>Platform fee<small>max 3%, capped at $12</small></dt><dd>{money(it.price.platformFeeUsd).main}</dd></div>
              <div className="kv-total"><dt>Total</dt><dd>{total.main}{total.alt && <small>{total.alt}</small>}</dd></div>
              {it.price.protectionPremiumUsd > 0 && (
                <div className="kv-extra"><dt><ShieldIcon width={14} height={14} /> Optional protection</dt><dd>+ {money(it.price.protectionPremiumUsd).main}</dd></div>
              )}
            </dl>
          </section>

          {a && a.visaFlags.length > 0 && (
            <section>
              <h4>Entry &amp; visa checks</h4>
              <ul className="notes">
                {a.visaFlags.map((f) => (
                  <li key={f.country + f.reason} className={`note sev${f.severity}`}>
                    <div className="note-head">
                      <b>{COUNTRIES[f.country] ?? f.country}</b>
                      <span className="pill small-pill">{REQ_LABEL[f.requirement] ?? f.requirement}{f.maxStayDays ? ` · ${f.maxStayDays} days` : ''}</span>
                    </div>
                    <div className="muted small">{f.reason.replace(/_/g, ' ')} at {f.at} · {f.confidence} confidence</div>
                    {f.note && <div className="small">{f.note}</div>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {a && a.baggageWarnings.length > 0 && (
            <section>
              <h4>Baggage</h4>
              <ul className="notes">
                {a.baggageWarnings.map((w, i) => <li key={i} className="note warn small">{w.message}</li>)}
              </ul>
            </section>
          )}
        </div>
      )}

      <footer className="itin-actions">
        <button type="button" className="btn-link" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Hide details' : 'Price, visas & baggage'}
        </button>
        <button type="button" className="btn primary" onClick={onBook}>Select</button>
      </footer>
    </article>
  );
}
