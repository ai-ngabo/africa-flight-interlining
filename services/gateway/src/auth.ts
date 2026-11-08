import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

const key = new TextEncoder().encode(process.env.JWT_SECRET ?? 'dev-jwt-secret-change-me');
const OTP_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;

/** Stable pseudonymous user id derived from the phone number (no PII forwarded to services). */
export const userIdForPhone = (phone: string) => `u_${createHash('sha256').update(normalizePhone(phone)).digest('hex').slice(0, 20)}`;
export const normalizePhone = (p: string) => p.replace(/[^\d+]/g, '').replace(/^00/, '+');

const otps = new Map<string, { code: string; exp: number; attempts: number }>();

export function issueOtp(phone: string): string {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  otps.set(normalizePhone(phone), { code, exp: Date.now() + OTP_TTL_MS, attempts: 0 });
  // Production: send via SMS (Africa's Talking has a free sandbox). Dev: returned to caller.
  return code;
}

export function verifyOtp(phone: string, code: string): boolean {
  const k = normalizePhone(phone);
  const e = otps.get(k);
  if (!e || e.exp < Date.now() || e.attempts >= MAX_ATTEMPTS) return false;
  e.attempts++;
  const ok = code.length === e.code.length && timingSafeEqual(Buffer.from(code), Buffer.from(e.code));
  if (ok) otps.delete(k);
  return ok;
}

export async function signToken(phone: string): Promise<string> {
  return new SignJWT({ sub: userIdForPhone(phone) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('24h').sign(key);
}

export async function verifyToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}
