import { describe, expect, it, vi } from "vitest";
import {
  RedisStorageMeterCacheStore,
  type StorageMeterRedis,
} from "../storage-meter-cache.store";

function createRedis(): StorageMeterRedis {
  return {
    get: vi.fn().mockRejectedValue(new Error("Redis unavailable")),
    setex: vi.fn().mockResolvedValue("OK"),
    set: vi.fn().mockResolvedValue("OK"),
  };
}

describe("RedisStorageMeterCacheStore", () => {
  it("keeps the process fallback warm for the full hard TTL", async () => {
    let now = 10_000;
    const cache = RedisStorageMeterCacheStore.create({
      redis: createRedis(),
      ttlMs: 30_000,
      now: () => now,
    });
    const value = { bytes: 0, computedAt: 5_000 };

    await cache.set("project", value);
    now += 29_999;

    await expect(cache.tryGet("project")).resolves.toEqual(value);

    now += 2;
    await expect(cache.tryGet("project")).resolves.toBeUndefined();
  });

  it("keeps a successful distributed claim locally locked during Redis failure", async () => {
    let now = 10_000;
    const redis = createRedis();
    const cache = RedisStorageMeterCacheStore.create({
      redis,
      ttlMs: 30_000,
      now: () => now,
    });

    await expect(cache.claim("project", now)).resolves.toBe(true);
    vi.mocked(redis.set).mockRejectedValue(new Error("Redis unavailable"));

    await expect(cache.claim("project", now)).resolves.toBe(false);

    now += 60_001;
    await expect(cache.claim("project", now)).resolves.toBe(true);
  });
});
