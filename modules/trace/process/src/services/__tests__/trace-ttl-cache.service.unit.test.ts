import { describe, expect, it } from "vitest";

import { TraceTtlCacheService } from "../trace-ttl-cache.service.ts";

describe("TraceTtlCacheService", () => {
  describe("when a key was written", () => {
    it("answers a hit carrying the value", async () => {
      const cache = TraceTtlCacheService.create<{ name: string; count: number }>(30_000);

      await cache.set("key1", { name: "a", count: 1 });

      expect(await cache.get("key1")).toEqual({ kind: "hit", value: { name: "a", count: 1 } });
    });

    it("answers a miss once the entry's lifetime passes", async () => {
      const cache = TraceTtlCacheService.create<number>(50);

      await cache.set("key1", 42);
      await new Promise((r) => setTimeout(r, 60));

      expect(await cache.get("key1")).toEqual({ kind: "miss" });
    });

    it("keeps an entry for the lifetime the caller named", async () => {
      const cache = TraceTtlCacheService.create<number>(50);

      await cache.set("key1", 42, 30_000);
      await new Promise((r) => setTimeout(r, 60));

      expect(await cache.get("key1")).toEqual({ kind: "hit", value: 42 });
    });

    it("answers a miss after the key is deleted", async () => {
      const cache = TraceTtlCacheService.create<number>(30_000);

      await cache.set("key1", 42);
      await cache.delete("key1");

      expect(await cache.get("key1")).toEqual({ kind: "miss" });
    });
  });

  describe("when a key was never written", () => {
    it("answers a miss", async () => {
      const cache = TraceTtlCacheService.create<string>(30_000);

      expect(await cache.get("nonexistent")).toEqual({ kind: "miss" });
    });
  });

  describe("when claiming a key", () => {
    it("takes a key only once", async () => {
      const cache = TraceTtlCacheService.create<boolean>(30_000);

      expect(await cache.claim("lock1", true)).toBe(true);
      expect(await cache.claim("lock1", true)).toBe(false);
      expect(await cache.get("lock1")).toEqual({ kind: "hit", value: true });
    });

    it("frees a claimed key once its lifetime passes", async () => {
      const cache = TraceTtlCacheService.create<boolean>(30_000);

      expect(await cache.claim("lock1", true, 50)).toBe(true);
      await new Promise((r) => setTimeout(r, 60));

      expect(await cache.claim("lock1", true)).toBe(true);
    });
  });
});
