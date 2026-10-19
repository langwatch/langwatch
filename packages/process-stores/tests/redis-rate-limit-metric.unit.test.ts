/**
 * A denied check moves rate_limit_exceeded_total by the key's scope; an allow leaves it.
 * @see specs/auth/rate-limiting.feature
 */
import {
  createRecordingMeterProvider,
  type RecordingMeterProvider,
} from "@langwatch/observability/metrics/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { redisRateLimiter } from "../src/redis-members.ts";

let metrics: RecordingMeterProvider;

/** A Redis answering the count a test names, and a retry-after of one second. */
function redisCounting(count: () => number) {
  return {
    eval: async () => count(),
    ttl: async () => 1,
  } as never;
}

function exceededFor(scope: string) {
  return metrics.recorded.filter(
    (entry) => entry.instrument === "rate_limit_exceeded_total" && entry.attributes.scope === scope,
  );
}

beforeEach(() => {
  metrics = createRecordingMeterProvider();
  metrics.install();
});
afterEach(() => metrics.uninstall());

describe("given a rate limit with a window's max", () => {
  describe("when a call is still under it", () => {
    /** @scenario "An allowed call leaves the counter unmoved" */
    it("allows the call and records no denial", async () => {
      const limiter = redisRateLimiter(
        redisCounting(() => 1),
        { requests: 2, seconds: 60 },
      );

      const decision = await limiter.check("auth.route:addr:abc");

      expect(decision.allowed).toBe(true);
      expect(
        metrics.recorded.filter((entry) => entry.instrument === "rate_limit_exceeded_total"),
      ).toEqual([]);
    });
  });

  describe("when a call arrives with the window already at its max", () => {
    /** @scenario "A denied call increments the counter for its scope" */
    it("denies it and counts one denial for the key's scope, never its address or hash", async () => {
      let used = 0;
      const limiter = redisRateLimiter(
        redisCounting(() => ++used),
        { requests: 2, seconds: 60 },
      );

      await limiter.check("auth.route:addr:abc");
      await limiter.check("auth.route:addr:abc");
      const decision = await limiter.check("auth.route:addr:abc");

      expect(decision.allowed).toBe(false);
      expect(exceededFor("auth.route")).toEqual([
        { instrument: "rate_limit_exceeded_total", value: 1, attributes: { scope: "auth.route" } },
      ]);
    });

    it("uses the whole key as the scope when it has no separator", async () => {
      const limiter = redisRateLimiter(
        redisCounting(() => 9),
        { requests: 1, seconds: 60 },
      );

      await limiter.check("plain-key");

      expect(exceededFor("plain-key")).toHaveLength(1);
    });
  });

  describe("when Redis answers a count already over the max", () => {
    /** @scenario "The Redis-backed path counts denials the same way as the in-memory path" */
    it("denies the call with a retry-after and counts one denial for the scope", async () => {
      const limiter = redisRateLimiter(
        redisCounting(() => 50),
        { requests: 5, seconds: 60 },
      );

      const decision = await limiter.check("user.register:addr:def");

      expect(decision).toEqual({ allowed: false, retryAfterSeconds: 1 });
      expect(exceededFor("user.register")).toEqual([
        {
          instrument: "rate_limit_exceeded_total",
          value: 1,
          attributes: { scope: "user.register" },
        },
      ]);
    });
  });
});
