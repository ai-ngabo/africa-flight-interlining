export const API = process.env.NEXT_PUBLIC_API_BASE ?? '';

export async function api<T>(path: string, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  const { token, headers, ...rest } = init;
  const res = await fetch(`${API}${path}`, {
    ...rest,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(headers as Record<string, string>) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const COUNTRIES: Record<string, string> = {
  DZ: 'Algeria', AO: 'Angola', BJ: 'Benin', BW: 'Botswana', BF: 'Burkina Faso', BI: 'Burundi', CV: 'Cabo Verde', CM: 'Cameroon',
  CF: 'Central African Rep.', TD: 'Chad', KM: 'Comoros', CG: 'Congo', CD: 'DR Congo', CI: "Côte d'Ivoire", DJ: 'Djibouti', EG: 'Egypt',
  GQ: 'Equatorial Guinea', ER: 'Eritrea', SZ: 'Eswatini', ET: 'Ethiopia', GA: 'Gabon', GM: 'Gambia', GH: 'Ghana', GN: 'Guinea',
  GW: 'Guinea-Bissau', KE: 'Kenya', LS: 'Lesotho', LR: 'Liberia', LY: 'Libya', MG: 'Madagascar', MW: 'Malawi', ML: 'Mali',
  MR: 'Mauritania', MU: 'Mauritius', MA: 'Morocco', MZ: 'Mozambique', NA: 'Namibia', NE: 'Niger', NG: 'Nigeria', RW: 'Rwanda',
  ST: 'São Tomé & Príncipe', SN: 'Senegal', SC: 'Seychelles', SL: 'Sierra Leone', SO: 'Somalia', ZA: 'South Africa', SS: 'South Sudan',
  SD: 'Sudan', TZ: 'Tanzania', TG: 'Togo', TN: 'Tunisia', UG: 'Uganda', ZM: 'Zambia', ZW: 'Zimbabwe',
};

export const CURRENCY_BY_COUNTRY: Record<string, string> = {
  RW: 'RWF', UG: 'UGX', KE: 'KES', TZ: 'TZS', ET: 'ETB', BI: 'BIF', CD: 'CDF', ZA: 'ZAR', NA: 'NAD', BW: 'BWP', ZM: 'ZMW', ZW: 'ZWG',
  MW: 'MWK', MZ: 'MZN', MU: 'MUR', SC: 'SCR', NG: 'NGN', GH: 'GHS', CI: 'XOF', SN: 'XOF', BJ: 'XOF', TG: 'XOF', BF: 'XOF', ML: 'XOF',
  NE: 'XOF', GW: 'XOF', CM: 'XAF', GA: 'XAF', CG: 'XAF', TD: 'XAF', CF: 'XAF', GQ: 'XAF', MA: 'MAD', EG: 'EGP',
};

export const fmtDur = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
export const fmtMoney = (n: number, ccy: string) =>
  new Intl.NumberFormat('en', { style: 'currency', currency: ccy === 'ZWG' ? 'USD' : ccy, maximumFractionDigits: n >= 1000 ? 0 : 2 }).format(n).replace('US$', ccy === 'ZWG' ? 'ZWG ' : 'US$');
