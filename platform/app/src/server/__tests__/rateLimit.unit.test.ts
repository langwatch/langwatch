import { beforeEach, describe, expect, it, vi } from "vitest";

const { tryGetAppMock } = vi.hoisted(() => ({
  tryGetAppMock: vi.fn(),
}));

vi.mock("../app-layer/app", () => ({ tryGetApp: tryGetAppMock }));

import { _resetMemoryRateLimitStore, rateLimit } from "../rateLimit";

describe("rateLimit (in-memory fallback)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    tryGetAppMock.mockReset();
    tryGetAppMock.mockReturnValue(undefined);
    _resetMemoryRateLimitStore();
  });

  describe("when called within a single window", () => {
    it("allows up to max requests then rejects", async () => {
      const opts = { key: "test:single", windowSeconds: 60, max: 3 };
      const r1 = await rateLimit(opts);
      const r2 = await rateLimit(opts);
      const r3 = await rateLimit(opts);
      const r4 = await rateLimit(opts);
      expect(r1.allowed).toBe(true);
      expect(r2.allowed).toBe(true);
      expect(r3.allowed).toBe(true);
      expect(r4.allowed).toBe(false);
    });

    it("counts down `remaining` correctly", async () => {
      const opts = { key: "test:remaining", windowSeconds: 60, max: 5 };
      const r1 = await rateLimit(opts);
      const r2 = await rateLimit(opts);
      const r3 = await rateLimit(opts);
      expect(r1.remaining).toBe(4);
      expect(r2.remaining).toBe(3);
      expect(r3.remaining).toBe(2);
    });

    it("returns the same resetAt across requests in the window", async () => {
      const opts = { key: "test:reset", windowSeconds: 60, max: 5 };
      const r1 = await rateLimit(opts);
      const r2 = await rateLimit(opts);
      expect(r2.resetAt).toBe(r1.resetAt);
    });
  });

  describe("when keys are distinct", () => {
    it("isolates limits between keys", async () => {
      const a = await rateLimit({
        key: "test:isolated:a",
        windowSeconds: 60,
        max: 1,
      });
      const b = await rateLimit({
        key: "test:isolated:b",
        windowSeconds: 60,
        max: 1,
      });
      expect(a.allowed).toBe(true);
      expect(b.allowed).toBe(true);
    });

    it("does not bleed counts across keys", async () => {
      const a1 = await rateLimit({
        key: "test:bleed:a",
        windowSeconds: 60,
        max: 2,
      });
      const b1 = await rateLimit({
        key: "test:bleed:b",
        windowSeconds: 60,
        max: 2,
      });
      const a2 = await rateLimit({
        key: "test:bleed:a",
        windowSeconds: 60,
        max: 2,
      });
      const a3 = await rateLimit({
        key: "test:bleed:a",
        windowSeconds: 60,
        max: 2,
      });
      expect(a1.allowed).toBe(true);
      expect(a2.allowed).toBe(true);
      expect(a3.allowed).toBe(false);
      // b is unaffected by a hitting its limit
      expect(b1.allowed).toBe(true);
    });
  });

  describe("when the window expires", () => {
    it("resets the counter for new requests", async () => {
      const opts = { key: "test:expire", windowSeconds: 0, max: 1 };
      const r1 = await rateLimit(opts);
      expect(r1.allowed).toBe(true);
      // Force the window to be already expired by sleeping past it.
      await new Promise((resolve) => setTimeout(resolve, 5));
      const r2 = await rateLimit(opts);
      // windowSeconds=0 means expiresAt = now + 0; the check is
      // `expiresAt <= now`, which is true after a tick → fresh bucket.
      expect(r2.allowed).toBe(true);
    });
  });

  describe("memory GC (in-memory store hygiene)", () => {
    it("does not leak expired entries from many distinct keys", async () => {
      // Hit 1100 distinct keys with windowSeconds=0 so they're all
      // immediately expired. The GC threshold is 1000; after that, the
      // sweep should fire on each call and free expired entries.
      for (let i = 0; i < 1100; i++) {
        await rateLimit({
          key: `gc-leak:${i}`,
          windowSeconds: 0,
          max: 1,
        });
      }
      // After the sweep, the store should NOT have grown to 1100 — most
      // entries were swept after the threshold tripped. We allow some
      // slack because the GC only runs ABOVE threshold, so the first
      // 1000 entries are still in the map until the 1001st write.
      // After hitting 1100 with sweep firing on each call from 1001
      // onward, the size should be well under 1100.
      // Wait one tick to ensure expiresAt < now for the most recent.
      await new Promise((resolve) => setTimeout(resolve, 5));
      // Trigger one more call to force the GC sweep on a now-expired set.
      await rateLimit({ key: "gc-leak:trigger", windowSeconds: 0, max: 1 });
      // The store can hold the most recent active entry plus
      // anything not yet expired. We expect a meaningful drop, not
      // full retention of all 1100.
      const { _getMemoryStoreSize } = await import("../rateLimit");
      const size = _getMemoryStoreSize();
      expect(size).toBeLessThan(1100);
    });
  });

  describe("when Redis is available but a command fails", () => {
    it.each([
      "incr",
      "expire",
      "ttl",
    ] as const)("falls through to the in-memory limiter after %s rejects", async (failingCommand) => {
      vi.spyOn(Date, "now").mockReturnValue(1_000);
      const incr = vi.fn().mockResolvedValue(1);
      const expire = vi.fn().mockResolvedValue(1);
      const ttl = vi.fn().mockResolvedValue(60);

      if (failingCommand === "incr") {
        incr.mockRejectedValue(new Error("redis incr unavailable"));
      } else if (failingCommand === "expire") {
        expire.mockRejectedValue(new Error("redis expire unavailable"));
      } else {
        ttl.mockRejectedValue(new Error("redis ttl unavailable"));
      }

      tryGetAppMock.mockReturnValue({ redis: { incr, expire, ttl } });
      const options = {
        key: `redis-failure:${failingCommand}`,
        windowSeconds: 60,
        max: 1,
      };

      const first = await rateLimit(options);
      const second = await rateLimit(options);

      expect(first).toEqual({
        allowed: true,
        remaining: 0,
        resetAt: 61_000,
      });
      expect(second).toEqual({
        allowed: false,
        remaining: 0,
        resetAt: 61_000,
      });
    });
  });
});
