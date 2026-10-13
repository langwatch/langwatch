/** The viewer cache's memory twin keeps the Redis windows: a viewing, then a payload. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryShareCacheRepository } from "../memory.share-cache.repository.ts";

describe("MemoryShareCacheRepository", () => {
  beforeEach(() => vi.useFakeTimers({ now: 0 }));
  afterEach(() => vi.useRealTimers());

  describe("when one viewer opens a link twice inside the window", () => {
    it("counts the first opening only, and again once the window has passed", async () => {
      const cache = MemoryShareCacheRepository.create();
      const viewing = { shareId: "share-1", viewerKey: "viewer-1" };

      await expect(cache.isNewViewing(viewing)).resolves.toBe(true);
      await expect(cache.isNewViewing(viewing)).resolves.toBe(false);
      await expect(cache.isNewViewing({ ...viewing, viewerKey: "viewer-2" })).resolves.toBe(true);
      vi.advanceTimersByTime(30 * 60 * 1000);
      await expect(cache.isNewViewing(viewing)).resolves.toBe(true);
    });
  });

  describe("when a payload is cached", () => {
    it("answers a copy until it expires", async () => {
      const cache = MemoryShareCacheRepository.create();

      await cache.setPayload("key", { trace: "t-1" });

      await expect(cache.findPayload("key")).resolves.toEqual({ trace: "t-1" });
      vi.advanceTimersByTime(60 * 1000);
      await expect(cache.findPayload("key")).resolves.toBeNull();
    });
  });
});
