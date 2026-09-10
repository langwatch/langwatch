import { afterEach, describe, expect, it, vi } from "vitest";
import { KILL_SWITCH_CACHE_TTL_MS } from "@langwatch/feature-flag-contract";
import { WorkerFeatureFlagCache } from "../worker-feature-flag-cache.ts";
import type { WorkerFeatureFlagRedis } from "../worker-feature-flags.composition.ts";

function redisReturning(value: string | null): WorkerFeatureFlagRedis {
  return {
    get: vi.fn(async () => value),
    setex: vi.fn(async () => "OK"),
    del: vi.fn(async () => 1),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("WorkerFeatureFlagCache", () => {
  it("falls back to the bounded memory entry when Redis returns malformed JSON", async () => {
    const cache = WorkerFeatureFlagCache.create(redisReturning("not-json"));
    await cache.set("flag", { row: { enabled: true, rules: [] } });

    await expect(cache.findSlot("flag")).resolves.toEqual({
      row: { enabled: true, rules: [] },
    });
  });

  it("treats malformed Redis data as a miss when no memory fallback exists", async () => {
    const cache = WorkerFeatureFlagCache.create(
      redisReturning(JSON.stringify({ row: { enabled: "yes", rules: [] } })),
    );

    await expect(cache.findSlot("flag")).resolves.toBeUndefined();
  });

  it("expires the memory fallback at the configured cache TTL", async () => {
    vi.useFakeTimers();
    const cache = WorkerFeatureFlagCache.create(null);
    await cache.set("flag", { row: null });

    await expect(cache.findSlot("flag")).resolves.toEqual({ row: null });
    await vi.advanceTimersByTimeAsync(KILL_SWITCH_CACHE_TTL_MS);
    await expect(cache.findSlot("flag")).resolves.toBeUndefined();
  });
});
