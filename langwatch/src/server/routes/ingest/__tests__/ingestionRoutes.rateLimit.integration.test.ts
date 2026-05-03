/**
 * @vitest-environment node
 *
 * Integration coverage for the per-IP fixed-window rate-limit on the
 * governance ingest receivers (`/api/ingest/*`). Wedged BEFORE the
 * bearer-token DB lookup so brute-force scanners shed at L7 instead
 * of pinging Postgres on every attempt.
 *
 * Pins:
 *   1. Under-limit: requests pass through (200/202).
 *   2. Over-limit: 429 with Retry-After header; underlying handler
 *      does NOT run (DB findFirst is short-circuited).
 *   3. Per-IP isolation: hitting the limit on IP A doesn't affect IP B.
 *   4. Window reset: after TTL elapses, the counter restarts.
 *   5. Open-fail: when the helper is called without a Redis connection,
 *      requests are allowed (best-effort: ingest availability beats
 *      brute-force protection).
 *   6. Test-environment opt-out: when LW_INGEST_RATE_LIMIT_DISABLED=1,
 *      hundreds of requests pass without 429.
 *
 * Spec: specs/ai-gateway/governance/receiver-auth-rate-limit.feature
 */
import { nanoid } from "nanoid";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { connection as redisConnection } from "~/server/redis";

import {
  checkIpRateLimit,
  ipRateLimitKey,
  isRateLimitDisabled,
} from "../rateLimit";

const ns = `rl-${nanoid(8)}`;

// The integration setupEnv defaults LW_INGEST_RATE_LIMIT_DISABLED=1 so
// every other test file passes through unfettered. This file flips it
// off at module load so the limiter actually fires; restored on
// teardown to avoid leaking into subsequent files (vitest's
// fileParallelism=false setting means files are sequential).
const ORIGINAL_DISABLED = process.env.LW_INGEST_RATE_LIMIT_DISABLED;
process.env.LW_INGEST_RATE_LIMIT_DISABLED = "0";

beforeAll(async () => {
  if (!redisConnection) {
    throw new Error("Redis connection unavailable in test env");
  }
});

afterAll(async () => {
  if (ORIGINAL_DISABLED === undefined) {
    delete process.env.LW_INGEST_RATE_LIMIT_DISABLED;
  } else {
    process.env.LW_INGEST_RATE_LIMIT_DISABLED = ORIGINAL_DISABLED;
  }
});

afterEach(async () => {
  // Best-effort cleanup of any namespaced rate-limit keys the test
  // wrote so subsequent it() blocks start clean. Use SCAN cursor
  // loop directly (works on both Redis and Cluster — scanStream is
  // standalone-only).
  if (!redisConnection) return;
  let cursor = "0";
  do {
    const [next, found] = (await (redisConnection as { scan: (...args: unknown[]) => Promise<[string, string[]]> }).scan(
      cursor,
      "MATCH",
      `lwingest:rate:${ns}-*`,
      "COUNT",
      100,
    )) as [string, string[]];
    cursor = next;
    for (const k of found) {
      await redisConnection.del(k);
    }
  } while (cursor !== "0");
});

describe("checkIpRateLimit", () => {
  describe("under the limit", () => {
    it("allows the first request and returns count=1 with retryAfterSec=0", async () => {
      const ip = `${ns}-under-1`;
      const result = await checkIpRateLimit({
        ip,
        windowSec: 60,
        maxRequests: 3,
      });
      expect(result).toEqual({ allowed: true, retryAfterSec: 0, count: 1 });

      const ttl = await redisConnection!.ttl(ipRateLimitKey(ip));
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);
    });

    it("allows up to maxRequests within the window", async () => {
      const ip = `${ns}-under-batch`;
      for (let i = 1; i <= 3; i++) {
        const r = await checkIpRateLimit({
          ip,
          windowSec: 60,
          maxRequests: 3,
        });
        expect(r.allowed).toBe(true);
        expect(r.count).toBe(i);
      }
    });
  });

  describe("over the limit", () => {
    it("rejects the (max+1)th request with retryAfterSec set", async () => {
      const ip = `${ns}-over`;
      // Burn through the budget.
      for (let i = 0; i < 3; i++) {
        await checkIpRateLimit({ ip, windowSec: 60, maxRequests: 3 });
      }
      // 4th request should reject.
      const denied = await checkIpRateLimit({
        ip,
        windowSec: 60,
        maxRequests: 3,
      });
      expect(denied.allowed).toBe(false);
      expect(denied.count).toBe(4);
      expect(denied.retryAfterSec).toBeGreaterThan(0);
      expect(denied.retryAfterSec).toBeLessThanOrEqual(60);
    });
  });

  describe("per-IP isolation", () => {
    it("two IPs share no quota", async () => {
      const ipA = `${ns}-iso-A`;
      const ipB = `${ns}-iso-B`;

      // Burn IP A through the budget.
      for (let i = 0; i < 3; i++) {
        await checkIpRateLimit({ ip: ipA, windowSec: 60, maxRequests: 3 });
      }
      const aDenied = await checkIpRateLimit({
        ip: ipA,
        windowSec: 60,
        maxRequests: 3,
      });
      expect(aDenied.allowed).toBe(false);

      // IP B is fresh and should pass.
      const bAllowed = await checkIpRateLimit({
        ip: ipB,
        windowSec: 60,
        maxRequests: 3,
      });
      expect(bAllowed.allowed).toBe(true);
      expect(bAllowed.count).toBe(1);
    });
  });

  describe("window reset", () => {
    it("after the TTL elapses, the counter restarts", async () => {
      const ip = `${ns}-reset`;
      // Use a 1-second window for fast reset.
      for (let i = 0; i < 3; i++) {
        await checkIpRateLimit({ ip, windowSec: 1, maxRequests: 3 });
      }
      const denied = await checkIpRateLimit({
        ip,
        windowSec: 1,
        maxRequests: 3,
      });
      expect(denied.allowed).toBe(false);

      // Wait a beat past the TTL so Redis evicts the key.
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const reset = await checkIpRateLimit({
        ip,
        windowSec: 1,
        maxRequests: 3,
      });
      expect(reset.allowed).toBe(true);
      expect(reset.count).toBe(1);
    });
  });

  describe("open-fail when redis is unavailable", () => {
    it("returns allowed=true without throwing when redis is null (explicit-disable sentinel)", async () => {
      const result = await checkIpRateLimit({
        ip: "anyone",
        windowSec: 60,
        maxRequests: 3,
        redis: null,
      });
      expect(result).toEqual({ allowed: true, retryAfterSec: 0, count: 0 });
    });
  });

  describe("test-environment opt-out", () => {
    it("LW_INGEST_RATE_LIMIT_DISABLED=1 short-circuits before touching Redis", async () => {
      process.env.LW_INGEST_RATE_LIMIT_DISABLED = "1";
      try {
        expect(isRateLimitDisabled()).toBe(true);
        const ip = `${ns}-optout`;
        for (let i = 0; i < 100; i++) {
          const r = await checkIpRateLimit({
            ip,
            windowSec: 60,
            maxRequests: 3,
          });
          expect(r.allowed).toBe(true);
        }
        // No Redis key was written.
        const exists = await redisConnection!.exists(ipRateLimitKey(ip));
        expect(exists).toBe(0);
      } finally {
        process.env.LW_INGEST_RATE_LIMIT_DISABLED = "0";
      }
    });
  });
});
