/**
 * The shared bucket, driven against a fake Redis that runs the real script's
 * arithmetic.
 *
 * The Lua itself is not executed here — that needs a server — so the fake
 * keeps the same state the script keeps and applies the same refill rule. What
 * this suite pins is the client half: that permits are drawn in chunks, that a
 * caller waits rather than being refused, and that an unreachable Redis is a
 * slowdown rather than an outage.
 *
 * @see ../globalRateLimiter.ts
 * @see specs/instant-evals/classifier.feature
 */

import type { RedisConnection } from "@langwatch/redis-client";
import { describe, expect, it } from "vitest";
import { RedisInstantEvalRateLimiter } from "../globalRateLimiter";

const CAPACITY = 200;
const REFILL = 100;

/** A Redis that keeps the bucket the script keeps, and counts what it was asked. */
function bucketRedis(): RedisConnection & { evals: number } {
  let tokens = CAPACITY;
  let at: number | null = null;
  const fake = {
    evals: 0,
    async eval(
      _script: string,
      _keyCount: number,
      _key: string,
      ...args: string[]
    ) {
      fake.evals += 1;
      const [capacity, refill, now, wanted] = args.map(Number) as [
        number,
        number,
        number,
        number,
      ];
      at ??= now;
      tokens = Math.min(capacity, tokens + ((now - at) / 1000) * refill);
      at = now;
      if (tokens >= wanted) {
        tokens -= wanted;
        return [wanted, 0];
      }
      if (tokens >= 1) {
        const granted = Math.floor(tokens);
        tokens -= granted;
        return [granted, 0];
      }
      return [0, Math.ceil(((1 - tokens) / refill) * 1000)];
    },
  };
  return fake as unknown as RedisConnection & { evals: number };
}

function limiterOn({
  redis,
  clock,
}: {
  redis: RedisConnection | null;
  clock: { now: number };
}) {
  return new RedisInstantEvalRateLimiter({
    redis,
    requestsPerSecond: REFILL,
    capacity: CAPACITY,
    now: () => clock.now,
    sleep: async (ms) => {
      clock.now += ms;
    },
  });
}

describe("given the shared bucket", () => {
  describe("when permits are taken one at a time", () => {
    /** @scenario "Permits are taken from one bucket shared by every pod" */
    it("draws them in chunks rather than one round trip each", async () => {
      const redis = bucketRedis();
      const limiter = limiterOn({ redis, clock: { now: 1_000 } });

      for (let taken = 0; taken < 8; taken++) await limiter.acquire();

      expect(redis.evals).toBe(1);

      await limiter.acquire();
      expect(redis.evals).toBe(2);
    });
  });

  describe("when the bucket is empty", () => {
    /** @scenario "An empty bucket refills at the configured rate" */
    it("waits, and the wait is what makes the next permit available", async () => {
      const redis = bucketRedis();
      const clock = { now: 1_000 };
      const limiter = limiterOn({ redis, clock });

      // Drain the whole capacity, then ask for one more.
      for (let taken = 0; taken < CAPACITY; taken++) await limiter.acquire();
      const startedAt = clock.now;
      await limiter.acquire();

      expect(clock.now).toBeGreaterThan(startedAt);
    });
  });

  describe("when the bucket has been idle", () => {
    /** @scenario "The bucket never fills past its capacity" */
    it("never holds more than its capacity", async () => {
      const redis = bucketRedis();
      const clock = { now: 1_000 };
      const limiter = limiterOn({ redis, clock });

      clock.now += 3_600_000;
      let granted = 0;
      const startedAt = clock.now;
      while (granted < CAPACITY + 50) {
        await limiter.acquire();
        // The acquisition that had to wait is the one past capacity, so it is
        // not counted: what is being asserted is how many the bucket handed
        // out without the clock moving.
        if (clock.now !== startedAt) break;
        granted += 1;
      }

      expect(granted).toBe(CAPACITY);
    });
  });
});

describe("given a Redis that cannot be reached", () => {
  describe("when permits are asked for", () => {
    /** @scenario "A Redis that cannot be reached falls back to a local rate" */
    it("grants them locally rather than failing the query", async () => {
      const failing = {
        async eval() {
          throw new Error("connection refused");
        },
      } as unknown as RedisConnection;
      const clock = { now: 1_000 };
      const limiter = limiterOn({ redis: failing, clock });

      for (let taken = 0; taken < 40; taken++) await limiter.acquire();

      // Twenty a second locally, so forty permits cost about a second.
      expect(clock.now - 1_000).toBeGreaterThanOrEqual(900);
    });
  });
});
