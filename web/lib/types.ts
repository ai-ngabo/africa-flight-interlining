export interface MetaNode { code: string; name: string; metro: string; country: string; currency: string; type: 'airport' | 'bus_terminal' }

export interface Leg {
  carrier: string; carrierName: string; number: string; mode: 'flight' | 'bus'; from: string; to: string;
  depLocal: string; arrLocal: string; depUtc: string; arrUtc: string; durationMin: number; fareUsd: number; taxUsd: number;
  distanceKm: number; fairness: { ratio: number; benchmarkUsd: number; label: string };
}

export interface Connection {
  arriveAt: string; departFrom: string; type: 'protected' | 'self_transfer' | 'ground_transfer';
  layoverMin: number; requiredMin: number; bufferMin: number; overnight: boolean; groundTransferMin: number;
}

export interface VisaFlag { country: string; at: string; reason: string; requirement: string; severity: number; confidence: string; maxStayDays?: number; note?: string }

export interface Itinerary {
  id: string; legs: Leg[]; connections: Connection[]; modes: string[]; isVirtualInterline: boolean;
  departureUtc: string; arrivalUtc: string; totalDurationMin: number; tags: string[]; offerToken: string;
  price: { baseFareUsd: number; taxesUsd: number; platformFeeUsd: number; protectionPremiumUsd: number; totalWithoutProtectionUsd: number; totalWithProtectionUsd: number };
  fairness: { ratio: number; label: string };
  assessment?: {
    source: string; riskScore: number; riskLabel: string; connectionRisks: number[]; protectionPremiumUsd: number;
    travelDocStatus: string; visaFlags: VisaFlag[]; baggageWarnings: { at: string; message: string }[];
  };
}

export interface Booking {
  pnr: string; status: string; amountUsd: number; protection: boolean;
  segments: Array<{ idx: number; number: string; carrierName: string; from: string; to: string; depUtc: string; status: string; ticketRef?: string; source: string }>;
  events: Array<{ at: string; type: string; data?: Record<string, unknown> }>;
}

export interface Payment {
  paymentId: string; status: string; rail?: string; mode?: string; instructions?: string; payerAmount: number; payerCurrency: string;
  attempts: Array<{ rail: string; ok: boolean; error?: string }>; bookingConfirmed: boolean;
  settlement: { payerTotal: number; lines: Array<{ beneficiary: string; purpose: string; currency: string; amount: number; route: string }>; estimatedSavingsVsUsdRouting: { amount: number; currency: string } };
}
