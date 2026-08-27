import { KILL_SWITCH_CACHE_TTL_MS, featureFlagRulesSchema } from "@langwatch/feature-flag-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { z } from "zod";
import { FeatureFlagCachePort, type FeatureFlagCacheSlot } from "../ports/feature-flag-cache.port";

const CACHE_PREFIX = "feature_flag_store:v2:";
const cacheSlotSchema = z.object({
  row: z
    .object({
      enabled: z.boolean(),
      rules: featureFlagRulesSchema,
    })
    .nullable(),
});

type MemoryEntry = {
  slot: FeatureFlagCacheSlot;
  expiresAt: number;
};

export class RedisFeatureFlagCache extends FeatureFlagCachePort {
  private readonly memory = new Map<string, MemoryEntry>();

  static create(redis: RedisConnection | null): RedisFeatureFlagCache {
    return new RedisFeatureFlagCache(redis);
  }

  private constructor(private readonly redis: RedisConnection | null) {
    super();
  }

  async tryGet(key: string): Promise<FeatureFlagCacheSlot | undefined> {
    if (this.redis) {
      try {
        const value = await this.redis.get(`${CACHE_PREFIX}${key}`);
        if (value === null) {
          return void 0;
        }

        return cacheSlotSchema.parse(JSON.parse(value));
      } catch {
        return this.tryGetFromMemory(key);
      }
    }

    return this.tryGetFromMemory(key);
  }

  async set(key: string, slot: FeatureFlagCacheSlot): Promise<void> {
    this.memory.set(key, {
      slot,
      expiresAt: Date.now() + KILL_SWITCH_CACHE_TTL_MS,
    });

    if (!this.redis) {
      return;
    }

    try {
      await this.redis.setex(
        `${CACHE_PREFIX}${key}`,
        Math.ceil(KILL_SWITCH_CACHE_TTL_MS / 1_000),
        JSON.stringify(slot),
      );
    } catch {
      return;
    }
  }

  async delete(key: string): Promise<void> {
    this.memory.delete(key);
    if (!this.redis) {
      return;
    }

    try {
      await this.redis.del(`${CACHE_PREFIX}${key}`);
    } catch {
      return;
    }
  }

  private tryGetFromMemory(key: string): FeatureFlagCacheSlot | undefined {
    const entry = this.memory.get(key);
    if (!entry) {
      return void 0;
    }

    if (entry.expiresAt <= Date.now()) {
      this.memory.delete(key);
      return void 0;
    }

    return entry.slot;
  }
}
