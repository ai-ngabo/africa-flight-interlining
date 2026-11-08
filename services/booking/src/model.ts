import type { OfferPayload } from '@pai/shared';

export type BookingStatus = 'PENDING_PAYMENT' | 'TICKETED' | 'DISRUPTED_REBOOKED' | 'EXPIRED' | 'CANCELLED';
export type SegmentStatus = 'HELD' | 'TICKETED' | 'MISSED' | 'REPLACED';

export interface Segment {
  idx: number;
  carrier: string;
  carrierName: string;
  number: string;
  mode: string;
  from: string;
  to: string;
  depUtc: string;
  arrUtc: string;
  fareUsd: number;
  taxUsd: number;
  status: SegmentStatus;
  /** Separate ticket per carrier = virtual interline. */
  ticketRef?: string;
  source: 'original' | 'reaccommodation';
}

export interface Passenger {
  firstName: string;
  lastName: string;
  nationality: string;
  dateOfBirth?: string;
  documentNumber?: string;
}

export interface BookingEvent {
  at: string;
  type: string;
  data?: Record<string, unknown>;
}

export interface Booking {
  pnr: string;
  userId: string;
  status: BookingStatus;
  contact: { phone: string; email?: string };
  passengers: Passenger[];
  offer: OfferPayload;
  protection: boolean;
  /** Per-passenger price snapshot (from the signed offer). */
  unitPriceUsd: number;
  amountUsd: number;
  segments: Segment[];
  events: BookingEvent[];
  payment?: { paymentId: string; rail: string; payerCurrency: string; payerAmount: number; confirmedAt: string };
  holdExpiresAt: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface LedgerEntry {
  txId: string;
  pnr: string;
  account: string;
  debitCents: number;
  creditCents: number;
  memo: string;
  createdAt?: string;
}
