import { createHmac, timingSafeEqual } from 'node:crypto';
import type { OfferPayload } from './types';

const b64 = (buf: Buffer) => buf.toString('base64url');

function secret(): string {
  return process.env.OFFER_SIGNING_SECRET ?? 'dev-offer-secret-change-me';
}

/** Offer tokens let the booking service trust prices without re-pricing: payload.base64url + "." + HMAC. */
export function signOffer(payload: OfferPayload, key = secret()): string {
  const body = b64(Buffer.from(JSON.stringify(payload)));
  const sig = b64(createHmac('sha256', key).update(body).digest());
  return `${body}.${sig}`;
}

export class OfferError extends Error {
  constructor(message: string, public code: 'malformed' | 'bad_signature' | 'expired') {
    super(message);
  }
}

export function verifyOffer(token: string, key = secret(), now = new Date()): OfferPayload {
  const [body, sig] = token.split('.');
  if (!body || !sig) throw new OfferError('Malformed offer token', 'malformed');
  const expected = createHmac('sha256', key).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new OfferError('Offer signature invalid (tampered or wrong key)', 'bad_signature');
  }
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OfferPayload;
  if (new Date(payload.expiresAt) < now) throw new OfferError('Offer expired; search again for current prices', 'expired');
  return payload;
}
