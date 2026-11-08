export class HttpError extends Error {
  constructor(message: string, public status: number, public body?: unknown) {
    super(message);
  }
}

/** JSON fetch with timeout — every inter-service call is bounded so one slow service cannot stall the platform. */
export async function fetchJson<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 5000, headers, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: { 'content-type': 'application/json', ...(headers as Record<string, string>) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new HttpError(`${init.method ?? 'GET'} ${url} -> ${res.status}`, res.status, body);
  return body as T;
}

export const config = {
  // 127.0.0.1 (not "localhost") avoids slow IPv6-first resolution on Windows.
  searchUrl: process.env.SEARCH_URL ?? 'http://127.0.0.1:4001',
  bookingUrl: process.env.BOOKING_URL ?? 'http://127.0.0.1:4002',
  paymentUrl: process.env.PAYMENT_URL ?? 'http://127.0.0.1:4003',
  intelUrl: process.env.INTEL_URL ?? 'http://127.0.0.1:8000',
  internalKey: process.env.INTERNAL_API_KEY ?? 'dev-internal-key-change-me',
};

export function internalHeaders(): Record<string, string> {
  return { 'x-internal-key': config.internalKey };
}
