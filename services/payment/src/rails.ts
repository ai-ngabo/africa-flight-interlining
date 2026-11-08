import { randomUUID } from 'node:crypto';
import { convert } from '@pai/shared';

export type RailId = 'papss' | 'mtn_momo' | 'mpesa' | 'airtel_money' | 'card';
export type RailStatus = 'pending' | 'succeeded' | 'failed';

export interface RailRequest {
  paymentId: string;
  pnr: string;
  phone: string;
  currency: string;
  amount: number;
}

export interface RailResult {
  status: RailStatus;
  providerRef: string;
  mode: 'sandbox' | 'simulated';
  instructions: string;
}

export interface PaymentRail {
  id: RailId;
  name: string;
  request(r: RailRequest): Promise<RailResult>;
  check(providerRef: string, r: RailRequest): Promise<RailStatus>;
}

/**
 * Deterministic simulator used when no sandbox credentials are configured.
 * Phone numbers ending in 0000 behave like an empty mobile wallet (mobile money
 * rails decline) so the fallback router can be demoed falling back to PAPSS/card.
 */
const MOBILE_MONEY: RailId[] = ['mtn_momo', 'mpesa', 'airtel_money'];

class SimulatedRail implements PaymentRail {
  private started = new Map<string, number>();
  constructor(public id: RailId, public name: string, private instructions: string) {}
  async request(r: RailRequest): Promise<RailResult> {
    if (r.phone.endsWith('0000') && MOBILE_MONEY.includes(this.id)) throw new Error(`${this.name}: insufficient wallet balance (simulated)`);
    const ref = `SIM-${this.id}-${randomUUID().slice(0, 8)}`;
    this.started.set(ref, Date.now());
    return { status: 'pending', providerRef: ref, mode: 'simulated', instructions: this.instructions };
  }
  async check(ref: string): Promise<RailStatus> {
    const t = this.started.get(ref);
    if (!t) return 'failed';
    return Date.now() - t > 1500 ? 'succeeded' : 'pending';
  }
}

/** MTN MoMo Collections API — free sandbox at https://momodeveloper.mtn.com (sandbox only accepts EUR). */
class MtnMomoSandbox implements PaymentRail {
  id: RailId = 'mtn_momo';
  name = 'MTN Mobile Money (sandbox)';
  private base = 'https://sandbox.momodeveloper.mtn.com';
  constructor(private key: string, private user: string, private apiKey: string) {}
  private async token(): Promise<string> {
    const res = await fetch(`${this.base}/collection/token/`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${this.user}:${this.apiKey}`).toString('base64')}`, 'Ocp-Apim-Subscription-Key': this.key },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`MoMo token ${res.status}`);
    return ((await res.json()) as { access_token: string }).access_token;
  }
  async request(r: RailRequest): Promise<RailResult> {
    const ref = randomUUID();
    const res = await fetch(`${this.base}/collection/v1_0/requesttopay`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        'X-Reference-Id': ref,
        'X-Target-Environment': 'sandbox',
        'Ocp-Apim-Subscription-Key': this.key,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        amount: String(convert(r.amount, r.currency, 'EUR')),
        currency: 'EUR',
        externalId: r.paymentId,
        payer: { partyIdType: 'MSISDN', partyId: r.phone.replace(/^\+/, '') },
        payerMessage: `Booking ${r.pnr}`,
        payeeNote: `PNR ${r.pnr}`,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.status !== 202) throw new Error(`MoMo requesttopay ${res.status}`);
    return { status: 'pending', providerRef: ref, mode: 'sandbox', instructions: 'Approve the MoMo prompt on your phone.' };
  }
  async check(ref: string): Promise<RailStatus> {
    const res = await fetch(`${this.base}/collection/v1_0/requesttopay/${ref}`, {
      headers: { Authorization: `Bearer ${await this.token()}`, 'X-Target-Environment': 'sandbox', 'Ocp-Apim-Subscription-Key': this.key },
      signal: AbortSignal.timeout(8000),
    });
    const s = ((await res.json()) as { status: string }).status;
    return s === 'SUCCESSFUL' ? 'succeeded' : s === 'FAILED' ? 'failed' : 'pending';
  }
}

/** Safaricom M-Pesa Daraja STK push — free sandbox at https://developer.safaricom.co.ke. */
class MpesaSandbox implements PaymentRail {
  id: RailId = 'mpesa';
  name = 'M-Pesa (Daraja sandbox)';
  private base = 'https://sandbox.safaricom.co.ke';
  constructor(private key: string, private secret: string, private passkey: string, private shortcode: string, private callback: string) {}
  private async token() {
    const res = await fetch(`${this.base}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${Buffer.from(`${this.key}:${this.secret}`).toString('base64')}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Daraja token ${res.status}`);
    return ((await res.json()) as { access_token: string }).access_token;
  }
  private stamp() {
    const ts = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    return { Timestamp: ts, Password: Buffer.from(`${this.shortcode}${this.passkey}${ts}`).toString('base64') };
  }
  async request(r: RailRequest): Promise<RailResult> {
    const phone = r.phone.replace(/^\+/, '');
    const res = await fetch(`${this.base}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.token()}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        BusinessShortCode: this.shortcode, ...this.stamp(), TransactionType: 'CustomerPayBillOnline',
        Amount: Math.max(1, Math.round(convert(r.amount, r.currency, 'KES'))), PartyA: phone, PartyB: this.shortcode, PhoneNumber: phone,
        CallBackURL: this.callback, AccountReference: r.pnr, TransactionDesc: `Booking ${r.pnr}`,
      }),
      signal: AbortSignal.timeout(8000),
    });
    const body = (await res.json()) as { CheckoutRequestID?: string; ResponseCode?: string; errorMessage?: string };
    if (body.ResponseCode !== '0' || !body.CheckoutRequestID) throw new Error(`Daraja STK push failed: ${body.errorMessage ?? res.status}`);
    return { status: 'pending', providerRef: body.CheckoutRequestID, mode: 'sandbox', instructions: 'Enter your M-Pesa PIN on the prompt.' };
  }
  async check(ref: string): Promise<RailStatus> {
    const res = await fetch(`${this.base}/mpesa/stkpushquery/v1/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.token()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ BusinessShortCode: this.shortcode, ...this.stamp(), CheckoutRequestID: ref }),
      signal: AbortSignal.timeout(8000),
    });
    const body = (await res.json()) as { ResultCode?: string; errorCode?: string };
    if (body.errorCode) return 'pending'; // "transaction is being processed"
    return body.ResultCode === '0' ? 'succeeded' : 'failed';
  }
}

export function buildRails(): Record<RailId, PaymentRail> {
  const e = process.env;
  return {
    papss: new SimulatedRail('papss', 'PAPSS bank transfer (simulated)', 'Authorise the PAPSS transfer in your banking app. PAPSS has no public sandbox; access is via participating banks.'),
    mtn_momo: e.MOMO_SUBSCRIPTION_KEY && e.MOMO_API_USER && e.MOMO_API_KEY
      ? new MtnMomoSandbox(e.MOMO_SUBSCRIPTION_KEY, e.MOMO_API_USER, e.MOMO_API_KEY)
      : new SimulatedRail('mtn_momo', 'MTN Mobile Money (simulated)', 'Approve the MoMo prompt on your phone.'),
    mpesa: e.MPESA_CONSUMER_KEY && e.MPESA_CONSUMER_SECRET && e.MPESA_PASSKEY
      ? new MpesaSandbox(e.MPESA_CONSUMER_KEY, e.MPESA_CONSUMER_SECRET, e.MPESA_PASSKEY, e.MPESA_SHORTCODE ?? '174379', e.MPESA_CALLBACK_URL ?? 'https://example.com/mpesa/callback')
      : new SimulatedRail('mpesa', 'M-Pesa (simulated)', 'Enter your M-Pesa PIN on the prompt.'),
    airtel_money: new SimulatedRail('airtel_money', 'Airtel Money (simulated)', 'Approve the Airtel Money prompt on your phone.'),
    card: new SimulatedRail('card', 'Card (simulated)', 'Complete 3-D Secure in the hosted payment page.'),
  };
}

/** Mobile-money-first ordering per country (card penetration is low in many markets). */
const BY_COUNTRY: Record<string, RailId[]> = {
  RW: ['mtn_momo', 'airtel_money', 'papss', 'card'],
  UG: ['mtn_momo', 'airtel_money', 'papss', 'card'],
  KE: ['mpesa', 'airtel_money', 'papss', 'card'],
  TZ: ['mpesa', 'airtel_money', 'papss', 'card'],
  GH: ['mtn_momo', 'papss', 'card'],
  CM: ['mtn_momo', 'papss', 'card'],
  CI: ['mtn_momo', 'papss', 'card'],
  BJ: ['mtn_momo', 'papss', 'card'],
  ZM: ['mtn_momo', 'airtel_money', 'papss', 'card'],
  CD: ['airtel_money', 'mpesa', 'papss', 'card'],
  MW: ['airtel_money', 'papss', 'card'],
  NG: ['papss', 'card'],
};

export function railsFor(country: string): RailId[] {
  return BY_COUNTRY[country.toUpperCase()] ?? ['papss', 'card'];
}
