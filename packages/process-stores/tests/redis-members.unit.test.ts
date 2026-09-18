/**
 * The Redis-backed limiter: the constructed window is the default, a caller's
 * own window per check the override. No socket: a memory counter stands in.
 */
import { describe, expect, it } from "vitest";

import { redisRateLimiter } from "../src/redis-members.ts";

/** The three commands the limiter issues, over a memory counter. */
function memoryRedis() {
  const counters = new Map<string, number>();
  const expiries = new Map<string, number>();

  const redis = {
    incr: async (key: string): Promise<number> => {
      const used = (counters.get(key) ?? 0) + 1;
      counters.set(key, used);

      return used;
    },
    expire: async (key: string, seconds: number): Promise<number> => {
      expiries.set(key, seconds);

      return 1;
    },
    ttl: async (key: string): Promise<number> => expiries.get(key) ?? -1,
  };

  return { redis: redis as never, expiries };
}

describe("given a limiter constructed with a window", () => {
  describe("when a caller names no window of its own", () => {
    it("allows up to the constructed allowance, then refuses with a positive retry-after", async () => {
      const { redis } = memoryRedis();
      const limiter = redisRateLimiter(redis, { requests: 2, seconds: 60 });

      expect(await limiter.check("caller-1")).toEqual({ allowed: true });
      expect(await limiter.check("caller-1")).toEqual({ allowed: true });

      const refused = await limiter.check("caller-1");

      expect(refused.allowed).toBe(false);
      expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    });

    it("expires the counter after the constructed window", async () => {
      const { redis, expiries } = memoryRedis();
      const limiter = redisRateLimiter(redis, { requests: 2, seconds: 45 });

      await limiter.check("caller-1");

      expect(expiries.get("member:rate-limit:caller-1")).toBe(45);
    });
  });

  describe("when a caller names its own window", () => {
    it("counts against the override rather than the constructed allowance", async () => {
      const { redis, expiries } = memoryRedis();
      const limiter = redisRateLimiter(redis, { requests: 5, seconds: 60 });
      const override = { requests: 2, seconds: 30 };

      expect(await limiter.check("caller-1", override)).toEqual({ allowed: true });
      expect(await limiter.check("caller-1", override)).toEqual({ allowed: true });

      const refused = await limiter.check("caller-1", override);

      expect(refused.allowed).toBe(false);
      expect(refused.retryAfterSeconds).toBeGreaterThan(0);
      expect(expiries.get("member:rate-limit:caller-1")).toBe(30);
    });

    it("leaves the constructed allowance to a caller that names none", async () => {
      const { redis } = memoryRedis();
      const limiter = redisRateLimiter(redis, { requests: 1, seconds: 60 });

      expect(await limiter.check("shared", { requests: 2, seconds: 30 })).toEqual({
        allowed: true,
      });
      expect(await limiter.check("other")).toEqual({ allowed: true });

      const refused = await limiter.check("other");

      expect(refused.allowed).toBe(false);
    });
  });
});
