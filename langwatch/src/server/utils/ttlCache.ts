import { isBuildOrNoRedis, connection as redisConnection } from "../redis";

const REDIS_PREFIX = "ttlcache:";

type MemoryEntry<T> = { value: T; expiresAt: number };

/**
 * TTL cache backed by Redis, with in-memory fallback.
 *
 * - Redis available: reads/writes go to Redis (shared across pods)
 * - Redis down or slow: falls back to in-memory Map (per-pod, same TTL)
 * - No Redis configured: in-memory only (dev/test)
 *
 * The memory fallback activates automatically on Redis errors,
 * preventing upstream systems from being hammered when Redis is unavailable.
 */
export class TtlCache<T> {
  private readonly ttlMs: number;
  private readonly ttlSeconds: number;
  private readonly prefix: string;
  private readonly memory = new Map<string, MemoryEntry<T>>();

  constructor(ttlMs: number, prefix: string = REDIS_PREFIX) {
    this.ttlMs = ttlMs;
    this.ttlSeconds = Math.ceil(ttlMs / 1000);
    this.prefix = prefix;
  }

  private get redis() {
    if (isBuildOrNoRedis || !redisConnection) return null;
    return redisConnection;
  }

  async get(key: string): Promise<T | undefined> {
    const r = this.redis;
    if (r) {
      try {
        const result = await r.get(`${this.prefix}${key}`);
        if (result !== null) return JSON.parse(result) as T;
        return undefined;
      } catch {
        // Redis failed, fall through to memory
      }
    }
    return this.memoryGet(key);
  }

  async set(key: string, value: T): Promise<void> {
    // Always set in memory as fallback
    this.memory.set(key, { value, expiresAt: Date.now() + this.ttlMs });

    const r = this.redis;
    if (!r) return;
    try {
      await r.setex(`${this.prefix}${key}`, this.ttlSeconds, JSON.stringify(value));
    } catch {
      // Redis unavailable, memory fallback already set
    }
  }

  async delete(key: string): Promise<void> {
    this.memory.delete(key);

    const r = this.redis;
    if (!r) return;
    try {
      await r.del(`${this.prefix}${key}`);
    } catch {
      // Redis unavailable
    }
  }

  private memoryGet(key: string): T | undefined {
    const entry = this.memory.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.memory.delete(key);
      return undefined;
    }
    return entry.value;
  }
}
