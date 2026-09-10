import { KILL_SWITCH_CACHE_TTL_MS, featureFlagRulesSchema } from "@langwatch/feature-flag-contract";
import type { FeatureFlagCache, FeatureFlagCacheSlot } from "@langwatch/feature-flag-server";
import { nowInstant } from "@langwatch/time";
import { z } from "zod";
import type { WorkerFeatureFlagRedis } from "./worker-feature-flags.composition.ts";

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

/**
 * This process's shared cache tier for operator rows, over Redis with a
 * per-process in-memory fallback for when Redis is absent or fails.
 */
export class WorkerFeatureFlagCache implements FeatureFlagCache {
  private readonly memory = new Map<string, MemoryEntry>();

  static create(redis: WorkerFeatureFlagRedis | null): WorkerFeatureFlagCache {
    return new WorkerFeatureFlagCache(redis);
  }

  private constructor(private readonly redis: WorkerFeatureFlagRedis | null) {}

  async findSlot(key: string): Promise<FeatureFlagCacheSlot | undefined> {
    if (this.redis) {
      try {
        const value = await this.redis.get(`${CACHE_PREFIX}${key}`);
        if (value === null) {
          return void 0;
        }

        return cacheSlotSchema.parse(JSON.parse(value));
      } catch {
        return this.findSlotInMemory(key);
      }
    }

    return this.findSlotInMemory(key);
  }

  async set(key: string, slot: FeatureFlagCacheSlot): Promise<void> {
    this.memory.set(key, {
      slot,
      expiresAt: nowInstant().epochMilliseconds + KILL_SWITCH_CACHE_TTL_MS,
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

  private findSlotInMemory(key: string): FeatureFlagCacheSlot | undefined {
    const entry = this.memory.get(key);
    if (!entry) {
      return void 0;
    }

    if (entry.expiresAt <= nowInstant().epochMilliseconds) {
      this.memory.delete(key);
      return void 0;
    }

    return entry.slot;
  }
}
