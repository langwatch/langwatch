import { z } from "zod";

const cachedStorageBytesSchema = z
  .object({
    bytes: z.number().finite().nonnegative(),
    computedAt: z.number().finite(),
  })
  .strict();

export type CachedStorageBytes = z.infer<typeof cachedStorageBytesSchema>;

type MemoryEntry = {
  value: CachedStorageBytes;
  expiresAt: number;
};

export interface StorageMeterRedis {
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSeconds: number, value: string): Promise<unknown>;
  set(
    key: string,
    value: string,
    mode: "EX",
    ttlSeconds: number,
    condition: "NX",
  ): Promise<unknown>;
}

export abstract class StorageMeterCacheStore {
  abstract tryGet(key: string): Promise<CachedStorageBytes | undefined>;
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
    return new RedisStorageMeterCacheStore(
      options.redis ?? null,
      options.ttlMs,
      options.prefix ?? "storage-meter:v2:",
      options.refreshPrefix ?? "storage-meter:refresh:",
      options.now ?? Date.now,
    );
  }

  private readonly memory = new Map<string, MemoryEntry>();
  private readonly locks = new Map<string, number>();
  private readonly ttlSeconds: number;

  private constructor(
    private readonly redis: StorageMeterRedis | null,
    private readonly ttlMs: number,
    private readonly prefix: string,
    private readonly refreshPrefix: string,
    private readonly now: () => number,
  ) {
    super();
    this.ttlSeconds = Math.ceil(ttlMs / 1_000);
  }

  async tryGet(key: string): Promise<CachedStorageBytes | undefined> {
    if (this.redis) {
      try {
        const encoded = await this.redis.get(this.redisKey(key));
        if (encoded !== null) {
          return cachedStorageBytesSchema.parse(JSON.parse(encoded));
        }

        return void 0;
      } catch {
        // Redis is an acceleration path; the warm process-local value remains available.
      }
    }

    const entry = this.memory.get(key);
    if (!entry || entry.expiresAt < this.now()) {
      this.memory.delete(key);
      return void 0;
    }

    return entry.value;
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
