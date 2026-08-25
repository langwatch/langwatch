import {
  resolvedRetentionSchema,
  type ResolvedRetention,
} from "@langwatch/data-retention-contract";

/** Internal cache port; cache implementation and wiring stay server-owned. */
export abstract class DataRetentionCache {
  abstract get(key: string): Promise<ResolvedRetention | null | undefined>;
  abstract set(key: string, value: ResolvedRetention | null): Promise<void>;
  abstract delete(key: string): Promise<void>;
}

export interface DataRetentionRedis {
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSeconds: number, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

type MemoryEntry = {
  value: ResolvedRetention | null;
  expiresAt: number;
};

/**
 * The one retention-policy cache. Redis is shared across processes; the
 * in-memory shadow keeps reads available when Redis is absent or unhealthy.
 */
export class RedisDataRetentionCache extends DataRetentionCache {
  static create(options: {
    redis?: DataRetentionRedis | null;
    ttlMs: number;
    prefix?: string;
    now?: () => number;
  }): RedisDataRetentionCache {
    return new RedisDataRetentionCache(
      options.redis ?? null,
      options.ttlMs,
      options.prefix ?? "retention-policy:",
      options.now ?? Date.now,
    );
  }

  private readonly memory = new Map<string, MemoryEntry>();
  private readonly ttlSeconds: number;

  private constructor(
    private readonly redis: DataRetentionRedis | null,
    private readonly ttlMs: number,
    private readonly prefix: string,
    private readonly now: () => number,
  ) {
    super();
    this.ttlSeconds = Math.ceil(ttlMs / 1_000);
  }

  async get(key: string): Promise<ResolvedRetention | null | undefined> {
    if (this.redis) {
      try {
        const encoded = await this.redis.get(this.redisKey(key));
        if (encoded !== null) {
          return resolvedRetentionSchema.nullable().parse(JSON.parse(encoded));
        }

        return void 0;
      } catch {
        // Redis is an acceleration path. The warm process-local shadow remains
        // authoritative for this process while Redis is unavailable.
      }
    }
    return this.getFromMemory(key);
  }

  async set(key: string, value: ResolvedRetention | null): Promise<void> {
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

  private getFromMemory(key: string): ResolvedRetention | null | undefined {
    const entry = this.memory.get(key);
    if (!entry) {
      return void 0;
    }

    if (this.now() > entry.expiresAt) {
      this.memory.delete(key);

      return void 0;
    }

    return entry.value;
  }

  private redisKey(key: string): string {
    return `${this.prefix}${key}`;
  }
}
