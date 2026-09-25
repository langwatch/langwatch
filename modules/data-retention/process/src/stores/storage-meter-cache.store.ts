import type { Cluster, Redis } from "ioredis";
import { z } from "zod";

const cachedStorageBytesSchema = z
  .object({
    bytes: z.number().finite().nonnegative(),
    computedAt: z.number().finite(),
  })
  .strict();

export type CachedStorageBytes = z.infer<typeof cachedStorageBytesSchema>;

/** A cache read: the bytes held under the key, or a miss the caller computes. */
export type CachedStorageBytesLookup =
  | { kind: "hit"; value: CachedStorageBytes }
  | { kind: "miss" };

type MemoryEntry = {
  value: CachedStorageBytes;
  expiresAt: number;
};

/** Only what this cache calls. */
export type StorageMeterRedis = Pick<Redis | Cluster, "get" | "setex" | "set">;

export abstract class StorageMeterCacheStore {
  abstract get(key: string): Promise<CachedStorageBytesLookup>;
  abstract set(key: string, value: CachedStorageBytes): Promise<void>;
  abstract claim(key: string, value: number): Promise<boolean>;
}

export class RedisStorageMeterCacheStore extends StorageMeterCacheStore {
  static create(options: {
    redis?: StorageMeterRedis | null;
    ttlMs: number;
    prefix?: string;
    refreshPrefix?: string;
    now?: () => number;
  }): RedisStorageMeterCacheStore {
    return new RedisStorageMeterCacheStore({
      redis: options.redis ?? null,
      ttlMs: options.ttlMs,
      prefix: options.prefix ?? "storage-meter:v2:",
      refreshPrefix: options.refreshPrefix ?? "storage-meter:refresh:",
      now: options.now ?? Date.now,
    });
  }

  private readonly memory = new Map<string, MemoryEntry>();
  private readonly locks = new Map<string, number>();
  private readonly ttlSeconds: number;

  private readonly redis: StorageMeterRedis | null;
  private readonly ttlMs: number;
  private readonly prefix: string;
  private readonly refreshPrefix: string;
  private readonly now: () => number;

  private constructor({
    redis,
    ttlMs,
    prefix,
    refreshPrefix,
    now,
  }: {
    redis: StorageMeterRedis | null;
    ttlMs: number;
    prefix: string;
    refreshPrefix: string;
    now: () => number;
  }) {
    super();
    this.redis = redis;
    this.ttlMs = ttlMs;
    this.prefix = prefix;
    this.refreshPrefix = refreshPrefix;
    this.now = now;
    this.ttlSeconds = Math.ceil(ttlMs / 1_000);
  }

  async get(key: string): Promise<CachedStorageBytesLookup> {
    if (this.redis) {
      try {
        const encoded = await this.redis.get(this.redisKey(key));
        if (encoded !== null) {
          return { kind: "hit", value: cachedStorageBytesSchema.parse(JSON.parse(encoded)) };
        }

        return { kind: "miss" };
      } catch {
        // Redis is an acceleration path; the warm process-local value remains available.
      }
    }

    const entry = this.memory.get(key);
    if (!entry || entry.expiresAt < this.now()) {
      this.memory.delete(key);
      return { kind: "miss" };
    }

    return { kind: "hit", value: entry.value };
  }

  async set(key: string, value: CachedStorageBytes): Promise<void> {
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

  async claim(key: string, value: number): Promise<boolean> {
    const lockKey = this.refreshPrefix + key;
    const lockTtlSeconds = 60;
    if (this.redis) {
      try {
        const result = await this.redis.set(lockKey, String(value), "EX", lockTtlSeconds, "NX");
        if (result === "OK") {
          this.locks.set(key, this.now() + lockTtlSeconds * 1_000);
        }
        return result === "OK";
      } catch {
        // Fall through to the process-local lock when Redis is unavailable.
      }
    }

    const expiresAt = this.locks.get(key);
    if (expiresAt !== void 0 && expiresAt > this.now()) {
      return false;
    }

    this.locks.set(key, this.now() + lockTtlSeconds * 1_000);
    return true;
  }

  private redisKey(key: string): string {
    return this.prefix + key;
  }
}
