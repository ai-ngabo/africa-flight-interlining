'use client';

import { useEffect, useMemo, useState } from 'react';
import BookingFlow from '../components/BookingFlow';
import ChatWidget from '../components/ChatWidget';
import ItineraryCard from '../components/ItineraryCard';
import ThemeToggle from '../components/ThemeToggle';
import { SwapIcon } from '../components/icons';
import type { MoneyFn } from '../components/money';
import { api, COUNTRIES, CURRENCY_BY_COUNTRY, fmtMoney } from '../lib/api';
import type { Itinerary, MetaNode } from '../lib/types';

const inAWeek = () => new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

interface SearchMeta { assessment: string; tookMs: number; candidatesExamined: number }

export default function Home() {
  const [nodes, setNodes] = useState<MetaNode[]>([]);
  const [form, setForm] = useState({ origin: 'KGL', destination: 'LOS', date: inAWeek(), nationality: 'RW', sort: 'best', coaches: true });
  const [results, setResults] = useState<Itinerary[] | null>(null);
  const [meta, setMeta] = useState<SearchMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rate, setRate] = useState(1);
  const [selected, setSelected] = useState<Itinerary | null>(null);
  const currency = CURRENCY_BY_COUNTRY[form.nationality] ?? 'USD';

  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    api<{ nodes: MetaNode[] }>('/api/meta').then((r) => setNodes(r.nodes)).catch(() => setError('Cannot reach the API gateway. Is `npm run dev:all` running?'));
    const saved = store.get('lastSearch');
    if (saved) try { setForm((f) => ({ ...f, ...JSON.parse(saved) })); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (currency === 'USD') return setRate(1);
    api<{ directRate: number }>(`/api/fx/quote?from=USD&to=${currency}&amount=1`).then((r) => setRate(r.directRate)).catch(() => setRate(1));
  }, [currency]);

  const money: MoneyFn = (usd) => (rate === 1 || currency === 'USD'
    ? { main: fmtMoney(usd, 'USD'), alt: '' }
    : { main: fmtMoney(usd * rate, currency), alt: fmtMoney(usd, 'USD') });

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (form.origin === form.destination) return setError('Origin and destination must be different.');
    setLoading(true);
    setError('');
    setSelected(null);
    store.set('lastSearch', JSON.stringify({ origin: form.origin, destination: form.destination, nationality: form.nationality }));
    try {
      const r = await api<{ itineraries: Itinerary[]; meta: SearchMeta }>('/api/search', {
        method: 'POST',
        body: JSON.stringify({ origin: form.origin, destination: form.destination, date: form.date, nationality: form.nationality, sort: form.sort, modes: form.coaches ? ['flight', 'bus'] : ['flight'] }),
      });
      setResults(r.itineraries);
      setMeta(r.meta);
    } catch (err) {
      setError((err as Error).message);
      setResults(null);
    } finally {
      setLoading(false);
    }
  }

  const grouped = useMemo(() => ({
    airports: nodes.filter((n) => n.type === 'airport').sort((a, b) => a.metro.localeCompare(b.metro)),
    buses: nodes.filter((n) => n.type === 'bus_terminal').sort((a, b) => a.metro.localeCompare(b.metro)),
  }), [nodes]);

  const nodeOptions = (
    <>
      <optgroup label="Airports">{grouped.airports.map((n) => <option key={n.code} value={n.code}>{n.metro} ({n.code})</option>)}</optgroup>
      <optgroup label="Coach terminals">{grouped.buses.map((n) => <option key={n.code} value={n.code}>{n.metro} – {n.name}</option>)}</optgroup>
    </>
  );

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand"><img src="/icon.svg" alt="" width={30} height={30} /> <span>AfriRoute</span></div>
          <ThemeToggle />
        </div>
      </header>

      <main>
        <section className="hero">
          <h1>Fair fares across Africa</h1>
          <p>Every carrier, flights and coaches, self-transfer protection and local-currency payment.</p>
        </section>

        <form className="card search" onSubmit={search}>
          <div className="search-route">
            <label className="field">
              <span>From</span>
              <select value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value })}>{nodeOptions}</select>
            </label>
            <button type="button" className="icon-btn swap" title="Swap origin and destination" aria-label="Swap origin and destination"
              onClick={() => setForm({ ...form, origin: form.destination, destination: form.origin })}>
              <SwapIcon width={16} height={16} />
            </button>
            <label className="field">
              <span>To</span>
              <select value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })}>{nodeOptions}</select>
            </label>
          </div>
          <div className="search-grid">
            <label className="field"><span>Date</span><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required /></label>
            <label className="field">
              <span>Passport</span>
              <select value={form.nationality} onChange={(e) => setForm({ ...form, nationality: e.target.value })}>
                {Object.entries(COUNTRIES).sort((a, b) => a[1].localeCompare(b[1])).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Sort by</span>
              <select value={form.sort} onChange={(e) => setForm({ ...form, sort: e.target.value })}>
                <option value="best">Best overall</option><option value="cheapest">Cheapest</option><option value="fastest">Fastest</option><option value="safest">Lowest risk</option>
              </select>
            </label>
          </div>
          <div className="search-foot">
            <label className="switch">
              <input type="checkbox" checked={form.coaches} onChange={(e) => setForm({ ...form, coaches: e.target.checked })} />
              <span className="switch-track" aria-hidden />
              Include coaches
            </label>
            <span className="muted small">Prices in {currency}</span>
            <button className="btn primary wide" disabled={loading}>{loading ? 'Searching…' : 'Search trips'}</button>
          </div>
        </form>

        {error && <div className="alert">{error}</div>}
        {meta && !selected && (
          <p className="results-meta">
            <b>{results?.length ?? 0} options</b> from {meta.candidatesExamined} combinations in {meta.tookMs} ms
            {meta.assessment === 'fallback' && ' · start the intelligence service for visa checks'}
          </p>
        )}
        {results && results.length === 0 && <div className="card empty">No itineraries found for this date. Try another day or include coaches.</div>}

        {selected ? (
          <BookingFlow itinerary={selected} nationality={form.nationality} currency={currency} money={money} onBack={() => setSelected(null)} />
        ) : (
          <div className="results">
            {results?.map((it) => <ItineraryCard key={it.id} it={it} money={money} onBook={() => { setSelected(it); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />)}
          </div>
        )}

        <footer className="site-foot muted small">MVP demo · schedules, fares and visa rules are sample data — verify before travel.</footer>
      </main>

      <ChatWidget nationality={form.nationality} />
    </>
  );
}
