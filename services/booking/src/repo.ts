import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { Booking, LedgerEntry } from './model';

export interface BookingRepo {
  kind: 'postgres' | 'memory';
  create(b: Booking): Promise<void>;
  get(pnr: string): Promise<Booking | null>;
  listByUser(userId: string): Promise<Booking[]>;
  /** Atomically saves the booking (optimistic concurrency on `version`) and appends balanced ledger entries. */
  save(b: Booking, ledger?: LedgerEntry[]): Promise<void>;
  ledger(pnr: string): Promise<LedgerEntry[]>;
}

export class ConcurrencyError extends Error {}

export function assertBalanced(entries: LedgerEntry[]) {
  const byTx = new Map<string, number>();
  for (const e of entries) {
    if (e.debitCents < 0 || e.creditCents < 0 || (e.debitCents > 0) === (e.creditCents > 0)) throw new Error(`Invalid ledger line ${e.account}`);
    byTx.set(e.txId, (byTx.get(e.txId) ?? 0) + e.debitCents - e.creditCents);
  }
  for (const [tx, bal] of byTx) if (bal !== 0) throw new Error(`Ledger transaction ${tx} unbalanced by ${bal} cents`);
}

export class MemoryRepo implements BookingRepo {
  kind = 'memory' as const;
  private bookings = new Map<string, Booking>();
  private entries: LedgerEntry[] = [];
  async create(b: Booking) {
    if (this.bookings.has(b.pnr)) throw new Error('PNR collision');
    this.bookings.set(b.pnr, structuredClone(b));
  }
  async get(pnr: string) {
    const b = this.bookings.get(pnr);
    return b ? structuredClone(b) : null;
  }
  async listByUser(userId: string) {
    return [...this.bookings.values()].filter((b) => b.userId === userId).map((b) => structuredClone(b));
  }
  async save(b: Booking, ledger: LedgerEntry[] = []) {
    const cur = this.bookings.get(b.pnr);
    if (!cur || cur.version !== b.version) throw new ConcurrencyError(`Booking ${b.pnr} was modified concurrently`);
    assertBalanced(ledger);
    const now = new Date().toISOString();
    this.bookings.set(b.pnr, structuredClone({ ...b, version: b.version + 1, updatedAt: now }));
    this.entries.push(...ledger.map((e) => ({ ...e, createdAt: now })));
    b.version += 1;
  }
  async ledger(pnr: string) {
    return this.entries.filter((e) => e.pnr === pnr);
  }
}

export class PostgresRepo implements BookingRepo {
  kind = 'postgres' as const;
  constructor(private pool: pg.Pool) {}

  static async connect(url: string): Promise<PostgresRepo> {
    const pool = new pg.Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 3000 });
    const schema = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../sql/schema.sql'), 'utf8');
    await pool.query(schema);
    return new PostgresRepo(pool);
  }

  async create(b: Booking) {
    await this.pool.query('INSERT INTO bookings (pnr, user_id, status, doc, version) VALUES ($1,$2,$3,$4,$5)', [b.pnr, b.userId, b.status, b, b.version]);
  }
  async get(pnr: string) {
    const r = await this.pool.query('SELECT doc, version FROM bookings WHERE pnr = $1', [pnr]);
    return r.rows[0] ? ({ ...r.rows[0].doc, version: r.rows[0].version } as Booking) : null;
  }
  async listByUser(userId: string) {
    const r = await this.pool.query('SELECT doc, version FROM bookings WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [userId]);
    return r.rows.map((row) => ({ ...row.doc, version: row.version }) as Booking);
  }
  async save(b: Booking, ledger: LedgerEntry[] = []) {
    assertBalanced(ledger);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const next = { ...b, version: b.version + 1, updatedAt: new Date().toISOString() };
      const r = await client.query('UPDATE bookings SET doc=$1, status=$2, version=version+1, updated_at=now() WHERE pnr=$3 AND version=$4', [next, b.status, b.pnr, b.version]);
      if (r.rowCount !== 1) throw new ConcurrencyError(`Booking ${b.pnr} was modified concurrently`);
      for (const e of ledger) {
        await client.query('INSERT INTO ledger_entries (tx_id, pnr, account, debit_cents, credit_cents, memo) VALUES ($1,$2,$3,$4,$5,$6)', [
          e.txId, e.pnr, e.account, e.debitCents, e.creditCents, e.memo,
        ]);
      }
      await client.query('COMMIT');
      b.version += 1;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  async ledger(pnr: string) {
    const r = await this.pool.query('SELECT tx_id, pnr, account, debit_cents, credit_cents, memo, created_at FROM ledger_entries WHERE pnr=$1 ORDER BY id', [pnr]);
    return r.rows.map((x) => ({ txId: x.tx_id, pnr: x.pnr, account: x.account, debitCents: Number(x.debit_cents), creditCents: Number(x.credit_cents), memo: x.memo, createdAt: x.created_at }));
  }
}

export async function createRepo(log: (m: string) => void): Promise<BookingRepo> {
  const url = process.env.DATABASE_URL;
  if (!url) return new MemoryRepo();
  try {
    return await PostgresRepo.connect(url);
  } catch (err) {
    log(`Postgres unavailable (${(err as Error).message}); using in-memory store (data is lost on restart)`);
    return new MemoryRepo();
  }
}
