import { config, fetchJson, internalHeaders, type Itinerary } from '@pai/shared';
import { userIdForPhone } from './auth';

/**
 * USSD menu compatible with Africa's Talking's callback format (free sandbox +
 * simulator at https://developers.africastalking.com). `text` is the
 * '*'-joined history of the user's inputs in the session.
 */
export async function handleUssd(text: string, phone: string): Promise<string> {
  const parts = text ? text.split('*').map((p) => p.trim().toUpperCase()) : [];
  const [menu, a, b, c] = parts;

  if (!menu) return 'CON AfriRoute\n1. Search trips\n2. My booking\n3. Visa check';

  if (menu === '1') {
    if (!a) return 'CON From (city code, e.g. KGL):';
    if (!b) return 'CON To (city code, e.g. LOS):';
    if (!c) return 'CON Date DDMM (e.g. 2011):';
    const date = resolveDate(c);
    if (!date) return 'END Invalid date. Use DDMM.';
    try {
      const res = await fetchJson<{ itineraries: Itinerary[] }>(`${config.searchUrl}/v1/search`, {
        method: 'POST',
        body: JSON.stringify({ origin: a, destination: b, date, sort: 'cheapest', limit: 3 }),
        timeoutMs: 6000,
      });
      if (!res.itineraries.length) return `END No trips ${a}-${b} on ${date}.`;
      const lines = res.itineraries.map((it, i) => {
        const stops = it.legs.length - 1;
        const via = stops ? ` via ${it.legs.slice(0, -1).map((l) => l.to).join(',')}` : '';
        return `${i + 1}) ${it.legs[0].depLocal.slice(11)} ${it.legs.map((l) => l.carrier).join('+')}${via} $${Math.round(it.price.totalWithoutProtectionUsd)}`;
      });
      return truncate(`END ${a}-${b} ${date}\n${lines.join('\n')}\nBook: app or *384#`);
    } catch {
      return 'END Search unavailable. Try again.';
    }
  }

  if (menu === '2') {
    if (!a) return 'CON Enter booking code (PNR):';
    try {
      const bk = await fetchJson<any>(`${config.bookingUrl}/v1/bookings/${a}`, { headers: { 'x-user-id': userIdForPhone(phone) } });
      const segs = bk.segments.filter((s: any) => s.status === 'TICKETED').map((s: any) => `${s.number} ${s.from}-${s.to} ${s.depUtc.slice(5, 16).replace('T', ' ')}Z`);
      return truncate(`END ${bk.pnr}: ${bk.status}\n${segs.join('\n')}`);
    } catch {
      return 'END Booking not found for this phone.';
    }
  }

  if (menu === '3') {
    if (!a) return 'CON Passport country (e.g. RW):';
    if (!b) return 'CON Destination country (e.g. NG):';
    try {
      const v = await fetchJson<any>(`${config.intelUrl}/v1/visa?nationality=${a}&destination=${b}`, { headers: internalHeaders() });
      const stay = v.maxStayDays ? ` ${v.maxStayDays}d` : '';
      return truncate(`END ${a}->${b}: ${String(v.requirement).replace(/_/g, ' ')}${stay} (${v.confidence} confidence). Verify officially.`);
    } catch {
      return 'END Visa service unavailable.';
    }
  }
  return 'END Invalid option.';
}

function resolveDate(ddmm: string): string | null {
  const m = ddmm.match(/^(\d{2})(\d{2})$/);
  if (!m) return null;
  const now = new Date();
  let year = now.getUTCFullYear();
  const candidate = Date.UTC(year, Number(m[2]) - 1, Number(m[1]));
  if (candidate < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) year++;
  const d = new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[1])));
  if (d.getUTCDate() !== Number(m[1])) return null;
  return d.toISOString().slice(0, 10);
}

/** USSD screens are limited to ~182 characters. */
const truncate = (s: string) => (s.length > 182 ? `${s.slice(0, 179)}...` : s);
