import { tryGetApp } from "../app-layer/app";

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

  /**
   * The App's connection, or null for the in-memory path.
   *
   * `tryGetApp` rather than `getApp` because falling back is this class's
   * contract, not a failure: no Redis configured, and no App yet, both mean
   * "cache in memory". Throwing here would turn the documented fallback into a
   * crash for every caller constructed at module scope (ADR-093).
   */
  private get redis() {
    return tryGetApp()?.redis ?? null;
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

  /**
   * Write `key`. `ttlMs` overrides the cache's own lifetime for this entry
   * only, in both Redis and the memory fallback, so a caller that knows how
   * long its value stays good can say so.
   */
  async set(key: string, value: T, ttlMs?: number): Promise<void> {
    const lifetimeMs = ttlMs ?? this.ttlMs;

    // Always shadow-write to memory so fallback is warm if Redis goes down later
    this.memory.set(key, { value, expiresAt: Date.now() + lifetimeMs });

    const r = this.redis;
    if (!r) return;
    try {
      await r.setex(
        `${this.prefix}${key}`,
        Math.ceil(lifetimeMs / 1000),
        JSON.stringify(value),
      );
    } catch {
      // Redis unavailable, memory fallback already set
    }
  }

  /**
   * Atomically set `key` only if it does not already exist (Redis SET NX EX).
   * Returns `true` if this call claimed the key, `false` if it was already taken.
   *
   * `ttlMs` overrides the cache's own lifetime for this entry only, the same
   * way `set` takes one, so a caller that knows how long its value stays good
   * says so on the call that writes it.
   *
   * This is the one method that does NOT fall back to memory on a Redis
   * error. Every other method degrades to a per-process answer that is at
   * worst stale; a claim that degrades that way hands `true` to one caller
   * per process and produces exactly the several winners it exists to
   * prevent. So a configured Redis that cannot answer raises, and the caller
   * decides: the agent cache's own caller treats it as "nothing arbitrated
   * this, so do the work", which is the result with no claim at all.
   *
   * With no Redis configured the memory map IS the cache, the same as it is
   * for `get` and `set`, and a claim inside one process is atomic.
   */
  async claim(key: string, value: T, ttlMs?: number): Promise<boolean> {
    const lifetimeMs = ttlMs ?? this.ttlMs;

    const r = this.redis;
    if (r) {
      const result = await r.set(
        `${this.prefix}${key}`,
        JSON.stringify(value),
        "EX",
        Math.ceil(lifetimeMs / 1000),
        "NX",
      );
      if (result === "OK") {
        this.memory.set(key, { value, expiresAt: Date.now() + lifetimeMs });
        return true;
      }
      return false;
    }

    if (this.memoryGet(key) !== undefined) return false;
    this.memory.set(key, { value, expiresAt: Date.now() + lifetimeMs });
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
