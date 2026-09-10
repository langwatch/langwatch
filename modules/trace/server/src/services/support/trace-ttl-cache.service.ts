import { nowInstant } from "@langwatch/time";

/**
 * The shared cache behind the explorer's facet and discover reads. Redis when the process
 * registered one, in-memory otherwise — the fallback is the contract, not a failure: no Redis
 * configured means cache per pod, which is what a dev stack and a test both want.
 */
export interface TraceCacheRedis {
  get(key: string): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<unknown>;
  /** The claim: `SET key value EX <seconds> NX`, which answers "OK" or null. */
  set(
    key: string,
    value: string,
    mode: "EX",
    seconds: number,
    exists: "NX",
  ): Promise<string | null>;
  del(key: string): Promise<unknown>;
}

let registeredRedis: TraceCacheRedis | null = null;

type MemoryEntry<T> = { value: T; expiresAt: number };

/**
 * TTL cache backed by Redis with an in-memory fallback: with Redis available reads and writes are
 * shared across pods, and on a Redis error or with none configured an in-memory map takes over at
 * the same TTL. The fallback engages automatically, so upstream systems are never hammered.
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
   * The process's connection, or null for the in-memory path. Null rather than a throw because
   * falling back is this class's contract: no Redis configured and no registration yet both mean
   * cache in memory, and throwing would crash every caller constructed at module scope (ADR-093).
   */
  private get redis(): TraceCacheRedis | null {
    return registeredRedis;
  }

  async tryGet(key: string): Promise<T | undefined> {
    const r = this.redis;
    if (r) {
      try {
        const result = await r.get(`${this.prefix}${key}`);
        if (result !== null) {
          return JSON.parse(result) as T;
        }

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
    this.memory.set(key, { value, expiresAt: nowInstant().epochMilliseconds + lifetimeMs });

    const r = this.redis;
    if (!r) {
      return;
    }

    try {
      await r.setex(`${this.prefix}${key}`, this.ttlSeconds, JSON.stringify(value));
    } catch {
      // Redis unavailable, memory fallback already set
    }
  }

  /**
   * Atomically claims `key` only if unset, reporting whether this call took it. The one method
   * that does not fall back to memory on a Redis error: a claim degrading that way would hand
   * `true` to one caller per process, the several winners it exists to prevent.
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
        this.memory.set(key, { value, expiresAt: nowInstant().epochMilliseconds + lifetimeMs });

        return true;
      }

      return false;
    }

    if (this.memoryGet(key) !== undefined) {
      return false;
    }

    this.memory.set(key, { value, expiresAt: nowInstant().epochMilliseconds + lifetimeMs });

    return true;
  }

  async delete(key: string): Promise<void> {
    this.memory.delete(key);

    const r = this.redis;
    if (!r) {
      return;
    }

    try {
      await r.del(`${this.prefix}${key}`);
    } catch {
      // Redis unavailable
    }
  }

  private memoryGet(key: string): T | undefined {
    const entry = this.memory.get(key);
    if (!entry) {
      return undefined;
    }

    if (nowInstant().epochMilliseconds > entry.expiresAt) {
      this.memory.delete(key);

      return undefined;
    }

    return entry.value;
  }
}

export class TraceTtlCacheService {
  static create(): TraceTtlCacheService {
    return new TraceTtlCacheService();
  }

  /** Registers the process's connection. Called once, at composition. */
  static setTraceCacheRedis(redis: TraceCacheRedis | null): void {
    registeredRedis = redis;
  }
}
