-- PostgreSQL schema (free, ACID) for bookings and the double-entry ledger.
CREATE TABLE IF NOT EXISTS bookings (
  pnr         TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  status      TEXT NOT NULL,
  doc         JSONB NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bookings_user_idx ON bookings (user_id);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id           BIGSERIAL PRIMARY KEY,
  tx_id        UUID NOT NULL,
  pnr          TEXT NOT NULL REFERENCES bookings(pnr),
  account      TEXT NOT NULL,
  debit_cents  BIGINT NOT NULL DEFAULT 0 CHECK (debit_cents >= 0),
  credit_cents BIGINT NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
  memo         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((debit_cents = 0) <> (credit_cents = 0))
);
CREATE INDEX IF NOT EXISTS ledger_pnr_idx ON ledger_entries (pnr);
CREATE INDEX IF NOT EXISTS ledger_account_idx ON ledger_entries (account);
