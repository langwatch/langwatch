import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TenantRateLimiter } from "../tenant-rate-limiter";

describe("TenantRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("tryConsume()", () => {
    describe("when bucket has capacity", () => {
      it("allows events up to capacity", () => {
        const limiter = new TenantRateLimiter({
          structural: { capacity: 3, refillRate: 0 },
          delta: { capacity: 5, refillRate: 0 },
        });

        expect(limiter.tryConsume("t1", "structural")).toBe(true);
        expect(limiter.tryConsume("t1", "structural")).toBe(true);
        expect(limiter.tryConsume("t1", "structural")).toBe(true);

        limiter.destroy();
      });
    });

    describe("when bucket is exhausted", () => {
      it("rejects events", () => {
        const limiter = new TenantRateLimiter({
          structural: { capacity: 2, refillRate: 0 },
          delta: { capacity: 5, refillRate: 0 },
        });

        expect(limiter.tryConsume("t1", "structural")).toBe(true);
        expect(limiter.tryConsume("t1", "structural")).toBe(true);
        expect(limiter.tryConsume("t1", "structural")).toBe(false);

        limiter.destroy();
      });
    });

    describe("when time passes and tokens refill", () => {
      it("allows events again after refill", () => {
        const limiter = new TenantRateLimiter({
          structural: { capacity: 2, refillRate: 1 },
          delta: { capacity: 5, refillRate: 0 },
        });

        // Exhaust the bucket
        expect(limiter.tryConsume("t1", "structural")).toBe(true);
        expect(limiter.tryConsume("t1", "structural")).toBe(true);
        expect(limiter.tryConsume("t1", "structural")).toBe(false);

        // Advance 1 second — should refill 1 token
        vi.advanceTimersByTime(1000);

        expect(limiter.tryConsume("t1", "structural")).toBe(true);
        expect(limiter.tryConsume("t1", "structural")).toBe(false);

        limiter.destroy();
      });

      it("caps tokens at capacity", () => {
        const limiter = new TenantRateLimiter({
          structural: { capacity: 3, refillRate: 100 },
          delta: { capacity: 5, refillRate: 0 },
        });

        // Exhaust
        limiter.tryConsume("t1", "structural");
        limiter.tryConsume("t1", "structural");
        limiter.tryConsume("t1", "structural");

        // Advance 10 seconds — would add 1000 tokens but should cap at 3
        vi.advanceTimersByTime(10_000);

        expect(limiter.tryConsume("t1", "structural")).toBe(true);
        expect(limiter.tryConsume("t1", "structural")).toBe(true);
        expect(limiter.tryConsume("t1", "structural")).toBe(true);
        expect(limiter.tryConsume("t1", "structural")).toBe(false);

        limiter.destroy();
      });
    });

    describe("when using different tiers", () => {
      it("maintains separate buckets per tier", () => {
        const limiter = new TenantRateLimiter({
          structural: { capacity: 1, refillRate: 0 },
          delta: { capacity: 2, refillRate: 0 },
        });

        // Exhaust structural
        expect(limiter.tryConsume("t1", "structural")).toBe(true);
        expect(limiter.tryConsume("t1", "structural")).toBe(false);

        // Delta should still work
        expect(limiter.tryConsume("t1", "delta")).toBe(true);
        expect(limiter.tryConsume("t1", "delta")).toBe(true);
        expect(limiter.tryConsume("t1", "delta")).toBe(false);

        limiter.destroy();
      });
    });

    describe("when using different tenants", () => {
      it("maintains independent buckets per tenant", () => {
        const limiter = new TenantRateLimiter({
          structural: { capacity: 1, refillRate: 0 },
          delta: { capacity: 5, refillRate: 0 },
        });

        expect(limiter.tryConsume("t1", "structural")).toBe(true);
        expect(limiter.tryConsume("t1", "structural")).toBe(false);

        // Different tenant, separate bucket
        expect(limiter.tryConsume("t2", "structural")).toBe(true);
        expect(limiter.tryConsume("t2", "structural")).toBe(false);

        limiter.destroy();
      });
    });

    describe("when first rate-limited", () => {
      it("logs a warning only once per tenant", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        const limiter = new TenantRateLimiter({
          structural: { capacity: 1, refillRate: 0 },
          delta: { capacity: 5, refillRate: 0 },
        });

        // First consume succeeds
        limiter.tryConsume("t1", "structural");
        expect(warnSpy).not.toHaveBeenCalled();

        // Second consume is rate-limited — warning emitted
        limiter.tryConsume("t1", "structural");
        expect(warnSpy).toHaveBeenCalledOnce();

        // Third attempt — no additional warning
        limiter.tryConsume("t1", "structural");
        expect(warnSpy).toHaveBeenCalledOnce();

        warnSpy.mockRestore();
        limiter.destroy();
      });
    });
  });

  describe("stale bucket cleanup", () => {
    describe("when a bucket is inactive for 60+ seconds", () => {
      it("removes the bucket", () => {
        const limiter = new TenantRateLimiter({
          structural: { capacity: 10, refillRate: 0 },
          delta: { capacity: 10, refillRate: 0 },
        });

        // Create a bucket
        limiter.tryConsume("t1", "structural");

        // Advance past cleanup interval (60s) + inactivity threshold (60s)
        // First tick at 60s marks bucket for cleanup check
        // The bucket hasn't been accessed for 60s by that point, so it gets removed
        vi.advanceTimersByTime(61_000);

        // Bucket should be removed — next consume starts fresh with full capacity
        // Consume all 10 tokens to verify it's a fresh bucket
        for (let i = 0; i < 10; i++) {
          expect(limiter.tryConsume("t1", "structural")).toBe(true);
        }
        expect(limiter.tryConsume("t1", "structural")).toBe(false);

        limiter.destroy();
      });
    });

    describe("when a bucket is actively used", () => {
      it("keeps the bucket", () => {
        const limiter = new TenantRateLimiter({
          structural: { capacity: 5, refillRate: 0 },
          delta: { capacity: 5, refillRate: 0 },
        });

        // Consume 3 tokens
        limiter.tryConsume("t1", "structural");
        limiter.tryConsume("t1", "structural");
        limiter.tryConsume("t1", "structural");

        // Advance 30s, then touch it again
        vi.advanceTimersByTime(30_000);
        limiter.tryConsume("t1", "structural");

        // Advance another 30s — not enough inactivity for cleanup
        vi.advanceTimersByTime(30_000);

        // Touch it again — still has only 1 token left (capacity 5, consumed 4, refillRate 0)
        expect(limiter.tryConsume("t1", "structural")).toBe(true);
        expect(limiter.tryConsume("t1", "structural")).toBe(false);

        limiter.destroy();
      });
    });
  });

  describe("destroy()", () => {
    it("clears the cleanup timer", () => {
      const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

      const limiter = new TenantRateLimiter();
      limiter.destroy();

      expect(clearIntervalSpy).toHaveBeenCalled();

      clearIntervalSpy.mockRestore();
    });
  });

  describe("when no config is provided", () => {
    it("uses default tier config", () => {
      const limiter = new TenantRateLimiter();

      // Default structural capacity is 200, so 200 consumes should succeed
      for (let i = 0; i < 200; i++) {
        expect(limiter.tryConsume("t1", "structural")).toBe(true);
      }

      // Default delta capacity is 500
      for (let i = 0; i < 500; i++) {
        expect(limiter.tryConsume("t1", "delta")).toBe(true);
      }

      limiter.destroy();
    });
  });
});
