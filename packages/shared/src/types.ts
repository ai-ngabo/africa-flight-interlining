export type Mode = 'flight' | 'bus';
export type NodeType = 'airport' | 'bus_terminal';

export interface TransitNode {
  code: string;
  name: string;
  metro: string;
  country: string;
  currency: string;
  type: NodeType;
  utcOffset: number;
  lat: number;
  lon: number;
  /** Minimum connection time when the connection is protected (same ticket / interline). */
  mctProtected: number;
  /** Minimum connection time for a self-transfer (immigration + bag reclaim + re-check-in). */
  mctSelfTransfer: number;
  /** Check-in buffer when arriving from outside (ground transfer). */
  checkinMin: number;
  /** Minutes from this node to the metro centre (used for ground transfers). */
  accessMin: number;
  terminalComplexity: number;
  departureTaxUsd: number;
  weatherRiskMonths: number[];
}

export interface Carrier {
  code: string;
  name: string;
  mode: Mode;
  hub: string;
  country: string;
  otp: number;
  checkedBags: number;
  checkedBagKg: number;
  cabinKg: number;
}

export interface ScheduledService {
  carrier: string;
  number: string;
  from: string;
  to: string;
  /** Local departure time "HH:MM" at origin. */
  dep: string;
  durationMin: number;
  /** ISO weekdays operated, 1=Mon..7=Sun. */
  days: number[];
  fareUsd: number;
  mode: Mode;
}

export interface Leg {
  carrier: string;
  carrierName: string;
  number: string;
  mode: Mode;
  from: string;
  to: string;
  fromCountry: string;
  toCountry: string;
  depUtc: string;
  arrUtc: string;
  depLocal: string;
  arrLocal: string;
  durationMin: number;
  fareUsd: number;
  taxUsd: number;
  distanceKm: number;
  carrierOtp: number;
  delayStdMin: number;
  frequencyPerWeek: number;
  fairness: FairnessInfo;
}

export type ConnectionType = 'protected' | 'self_transfer' | 'ground_transfer';

export interface Connection {
  /** Node where the inbound leg arrives. */
  arriveAt: string;
  /** Node where the outbound leg departs (differs from arriveAt for ground transfers). */
  departFrom: string;
  country: string;
  type: ConnectionType;
  layoverMin: number;
  requiredMin: number;
  bufferMin: number;
  groundTransferMin: number;
  terminalComplexity: number;
  weatherRisk: boolean;
  requiresImmigration: boolean;
  requiresBagRecheck: boolean;
  overnight: boolean;
}

export interface FairnessInfo {
  usdPerKm: number;
  benchmarkUsd: number;
  ratio: number;
  label: 'good_value' | 'fair' | 'above_benchmark';
}

export interface PriceBreakdown {
  baseFareUsd: number;
  taxesUsd: number;
  platformFeeUsd: number;
  protectionPremiumUsd: number;
  totalWithoutProtectionUsd: number;
  totalWithProtectionUsd: number;
}

export interface VisaFlag {
  country: string;
  at: string;
  reason: 'destination' | 'self_transfer_entry' | 'land_border' | 'airside_transit';
  requirement: string;
  severity: number;
  maxStayDays?: number;
  confidence: string;
  note?: string;
}

export interface BaggageWarning {
  at: string;
  message: string;
}

export interface Assessment {
  source: 'intelligence' | 'fallback';
  riskScore: number;
  riskLabel: 'low' | 'medium' | 'high';
  connectionRisks: number[];
  protectionPremiumUsd: number;
  travelDocStatus: 'ok' | 'action_needed' | 'visa_required' | 'unknown';
  visaFlags: VisaFlag[];
  baggageWarnings: BaggageWarning[];
}

export interface Itinerary {
  id: string;
  legs: Leg[];
  connections: Connection[];
  modes: Mode[];
  carriers: string[];
  isVirtualInterline: boolean;
  departureUtc: string;
  arrivalUtc: string;
  totalDurationMin: number;
  price: PriceBreakdown;
  fairness: { ratio: number; label: FairnessInfo['label'] };
  assessment?: Assessment;
  tags: string[];
  offerToken?: string;
}

export interface SearchRequest {
  origin: string;
  destination: string;
  date: string; // YYYY-MM-DD (origin local)
  nationality?: string;
  maxLegs?: number;
  modes?: Mode[];
  sort?: 'best' | 'cheapest' | 'fastest' | 'safest';
  limit?: number;
  /** Earliest departure in UTC ISO (used by disruption rebooking). */
  earliestDepartureUtc?: string;
}

/** Signed snapshot of an itinerary's commercial terms, verified by the booking service. */
export interface OfferPayload {
  itineraryId: string;
  legs: Array<Pick<Leg, 'carrier' | 'carrierName' | 'number' | 'mode' | 'from' | 'to' | 'depUtc' | 'arrUtc' | 'fareUsd' | 'taxUsd'>>;
  connections: Array<Pick<Connection, 'arriveAt' | 'departFrom' | 'type' | 'requiredMin'>>;
  price: PriceBreakdown;
  riskScore: number;
  destination: string;
  issuedAt: string;
  expiresAt: string;
}
