import { isBuildOrNoRedis, connection as redisConnection } from "../redis";

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

  constructor(ttlMs: number, prefix: string) {
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
    // Always shadow-write to memory so fallback is warm if Redis goes down later
    this.memory.set(key, { value, expiresAt: Date.now() + this.ttlMs });

    const r = this.redis;
    if (!r) return;
    try {
      await r.setex(`${this.prefix}${key}`, this.ttlSeconds, JSON.stringify(value));
    } catch {
      // Redis unavailable, memory fallback already set
    }
  }

  /**
   * Atomically set `key` only if it does not already exist (Redis SET NX EX).
   * Returns `true` if this call claimed the key, `false` if it was already taken.
   */
  async claim(key: string, value: T): Promise<boolean> {
    const r = this.redis;
    if (r) {
      try {
        const result = await r.set(
          `${this.prefix}${key}`,
          JSON.stringify(value),
          "EX",
          this.ttlSeconds,
          "NX",
        );
        if (result === "OK") {
          this.memory.set(key, { value, expiresAt: Date.now() + this.ttlMs });
          return true;
        }
        return false;
      } catch {
        // Redis failed, fall through to memory
      }
    }

    if (this.memoryGet(key) !== undefined) return false;
    this.memory.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    return true;
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
