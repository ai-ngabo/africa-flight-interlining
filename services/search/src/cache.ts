import { createClient } from 'redis';

export interface Cache {
  kind: 'redis' | 'memory';
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
}

class MemoryCache implements Cache {
  kind = 'memory' as const;
  private store = new Map<string, { v: string; exp: number }>();
  async get(key: string) {
    const e = this.store.get(key);
    if (!e) return null;
    if (e.exp < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return e.v;
  }
  async set(key: string, v: string, ttlSec: number) {
    if (this.store.size > 2000) this.store.delete(this.store.keys().next().value!);
    this.store.set(key, { v, exp: Date.now() + ttlSec * 1000 });
  }
}

/** Redis (free OSS) when REDIS_URL is set, otherwise a bounded in-process TTL cache. */
export async function createCache(log: (m: string) => void): Promise<Cache> {
  const url = process.env.REDIS_URL;
  if (!url) return new MemoryCache();
  try {
    const client = createClient({ url, socket: { connectTimeout: 2000, reconnectStrategy: false } });
    client.on('error', () => undefined);
    await client.connect();
    return {
      kind: 'redis',
      get: (k) => client.get(k),
      set: async (k, v, ttl) => {
        await client.set(k, v, { EX: ttl });
      },
    };
  } catch (err) {
    log(`Redis unavailable (${(err as Error).message}); using in-memory cache`);
    return new MemoryCache();
  }
}
