/**
 * @vitest-environment node
 *
 * Tests for the cacheTtlMs override path used by hot-path kill switch
 * callers. The underlying storage TTL must be wide enough that the override
 * actually wins, otherwise Redis evicts before the override window expires.
 *
 * @see specs/analytics/posthog-cost-control.feature
 */
import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";

// Force memory-only mode (no Redis) so tests are deterministic.
vi.mock("../../redis", () => ({
  isBuildOrNoRedis: true,
  connection: null,
}));

import { StaleWhileRevalidateCache } from "../staleWhileRevalidateCache.redis";

describe("StaleWhileRevalidateCache with ttl override", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when caller passes ttlOverrideMs longer than the default", () => {
    it("returns cached value past the default staleness window", async () => {
      const cache = new StaleWhileRevalidateCache(
        5_000, // default staleness
        5_000,
        60_000, // underlying max TTL — must accommodate longest override
      );

      await cache.set("k", true);

      vi.advanceTimersByTime(10_000); // past the default

      const withDefault = await cache.get("k");
      expect(withDefault).toBeUndefined();

      // Re-set so we can test the override path on a fresh entry.
      await cache.set("k", true);
      vi.advanceTimersByTime(10_000);

      const withOverride = await cache.get("k", 60_000);
      expect(withOverride?.value).toBe(true);
    });

    it("evicts past the override window too", async () => {
      const cache = new StaleWhileRevalidateCache(5_000, 5_000, 60_000);
      await cache.set("k", true);

      vi.advanceTimersByTime(70_000);

      const result = await cache.get("k", 60_000);
      expect(result).toBeUndefined();
    });
  });

  describe("when no override is passed", () => {
    it("uses the default staleness threshold", async () => {
      const cache = new StaleWhileRevalidateCache(5_000, 5_000, 60_000);
      await cache.set("k", true);

      vi.advanceTimersByTime(2_000);
      expect((await cache.get("k"))?.value).toBe(true);

      vi.advanceTimersByTime(10_000); // total 12s, past default 5s
      expect(await cache.get("k")).toBeUndefined();
    });
  });
});
