import {
  resolvedRetentionSchema,
  type ResolvedRetention,
} from "@langwatch/data-retention-contract";

/** A cache read: the retention held under the key, or a miss the caller resolves. */
export type CachedRetentionLookup = { kind: "hit"; value: ResolvedRetention } | { kind: "miss" };

/** Internal cache port; cache implementation and wiring stay server-owned. */
export abstract class DataRetentionCacheStore {
  abstract get(key: string): Promise<CachedRetentionLookup>;
  abstract set(key: string, value: ResolvedRetention): Promise<void>;
  abstract delete(key: string): Promise<void>;
}

export interface DataRetentionRedis {
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSeconds: number, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

type MemoryEntry = {
  value: ResolvedRetention;
  expiresAt: number;
};

/**
 * The one retention-policy cache. Redis is shared across processes; the
 * in-memory shadow keeps reads available when Redis is absent or unhealthy.
 */
export class RedisDataRetentionCacheStore extends DataRetentionCacheStore {
  static create(options: {
    redis?: DataRetentionRedis | null;
    ttlMs: number;
    prefix?: string;
    now?: () => number;
  }): RedisDataRetentionCacheStore {
    return new RedisDataRetentionCacheStore({
      redis: options.redis ?? null,
      ttlMs: options.ttlMs,
      prefix: options.prefix ?? "retention-policy:",
      now: options.now ?? Date.now,
    });
  }

  private readonly memory = new Map<string, MemoryEntry>();
  private readonly ttlSeconds: number;

  private readonly redis: DataRetentionRedis | null;
  private readonly ttlMs: number;
  private readonly prefix: string;
  private readonly now: () => number;

  private constructor({
    redis,
    ttlMs,
    prefix,
    now,
  }: {
    redis: DataRetentionRedis | null;
    ttlMs: number;
    prefix: string;
    now: () => number;
  }) {
    super();
    this.redis = redis;
    this.ttlMs = ttlMs;
    this.prefix = prefix;
    this.now = now;
    this.ttlSeconds = Math.ceil(ttlMs / 1_000);
  }

  async get(key: string): Promise<CachedRetentionLookup> {
    if (this.redis) {
      try {
        const encoded = await this.redis.get(this.redisKey(key));
        if (encoded !== null) {
          return { kind: "hit", value: resolvedRetentionSchema.parse(JSON.parse(encoded)) };
        }

        return { kind: "miss" };
      } catch {
        // Redis is an acceleration path. The warm process-local shadow remains
        // authoritative for this process while Redis is unavailable.
      }
    }
    return this.getFromMemory(key);
  }

  async set(key: string, value: ResolvedRetention): Promise<void> {
    this.memory.set(key, {
      value,
      expiresAt: this.now() + this.ttlMs,
    });

    if (!this.redis) {
      return;
    }

    try {
      await this.redis.setex(this.redisKey(key), this.ttlSeconds, JSON.stringify(value));
    } catch {
      // The process-local value was already written.
    }
  }

  async delete(key: string): Promise<void> {
    this.memory.delete(key);
    if (!this.redis) {
      return;
    }

    try {
      await this.redis.del(this.redisKey(key));
    } catch {
      // Expiry bounds a stale remote entry if Redis cannot be reached.
    }
  }

  private getFromMemory(key: string): CachedRetentionLookup {
    const entry = this.memory.get(key);
    if (!entry) {
      return { kind: "miss" };
    }

    if (this.now() > entry.expiresAt) {
      this.memory.delete(key);

      return { kind: "miss" };
    }

    return { kind: "hit", value: entry.value };
  }

  private redisKey(key: string): string {
    return `${this.prefix}${key}`;
  }
}
