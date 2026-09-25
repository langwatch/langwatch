import { redisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it, vi } from "vitest";

import { RedisStorageMeterCacheStore } from "../storage-meter-cache.store.ts";

function createRedisScript() {
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
      redis: redisDouble(createRedisScript()),
      ttlMs: 30_000,
      now: () => now,
    });
    const value = { bytes: 0, computedAt: 5_000 };

    await cache.set("project", value);
    now += 29_999;

    await expect(cache.get("project")).resolves.toEqual({ kind: "hit", value: value });

    now += 2;
    await expect(cache.get("project")).resolves.toEqual({ kind: "miss" });
  });

  it("keeps a successful distributed claim locally locked during Redis failure", async () => {
    let now = 10_000;
    const redis = createRedisScript();
    const cache = RedisStorageMeterCacheStore.create({
      redis: redisDouble(redis),
      ttlMs: 30_000,
      now: () => now,
    });

    await expect(cache.claim("project", now)).resolves.toBe(true);
    redis.set.mockRejectedValue(new Error("Redis unavailable"));

    await expect(cache.claim("project", now)).resolves.toBe(false);

    now += 60_001;
    await expect(cache.claim("project", now)).resolves.toBe(true);
  });
});
