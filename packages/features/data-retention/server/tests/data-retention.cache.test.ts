import { describe, expect, it, vi } from "vitest";
import {
  RedisDataRetentionCache,
  type DataRetentionRedis,
} from "../src/cache/data-retention.cache";

const retention = {
  traces: 49,
  scenarios: 63,
  experiments: 91,
};

describe("RedisDataRetentionCache", () => {
  it("uses the injected Redis connection and keeps a warm memory fallback", async () => {
    const redis = {
      get: vi.fn().mockRejectedValue(new Error("redis unavailable")),
      setex: vi.fn().mockResolvedValue("OK"),
      del: vi.fn().mockResolvedValue(1),
    } satisfies DataRetentionRedis;
    const cache = RedisDataRetentionCache.create({ redis, ttlMs: 60_000 });

    await cache.set("project", retention);

    await expect(cache.get("project")).resolves.toEqual(retention);
    expect(redis.setex).toHaveBeenCalledWith(
      "retention-policy:project",
      60,
      JSON.stringify(retention),
    );

    await cache.delete("project");
    await expect(cache.get("project")).resolves.toBeUndefined();
    expect(redis.del).toHaveBeenCalledWith("retention-policy:project");
  });

  it("expires the process-local fallback without a global app lookup", async () => {
    let now = 1_000;
    const cache = RedisDataRetentionCache.create({
      ttlMs: 50,
      now: () => now,
    });

    await cache.set("project", null);
    await expect(cache.get("project")).resolves.toBeNull();

    now = 1_051;
    await expect(cache.get("project")).resolves.toBeUndefined();
  });
});
