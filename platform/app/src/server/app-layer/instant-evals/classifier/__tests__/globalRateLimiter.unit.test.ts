/**
 * The shared token buckets, driven against a fake Redis that runs the real
 * script's arithmetic.
 *
 * The Lua itself is not executed here, that needs a server, so the fake keeps
 * the same state the script keeps and applies the same refill rule to both
 * buckets. What this suite pins is the client half: that a classification
 * takes its own estimated tokens, that both buckets are debited or neither is,
 * that a caller waits rather than being refused, and that an unreachable Redis
 * is a slowdown rather than an outage.
 *
 * @see ../globalRateLimiter.ts
 * @see specs/instant-evals/classifier.feature
 */

import type { RedisConnection } from "@langwatch/redis-client";
import { describe, expect, it } from "vitest";
import {
  LOCAL_FALLBACK_TOKENS_PER_SECOND,
  RedisInstantEvalRateLimiter,
} from "../globalRateLimiter";

const GLOBAL_REFILL = 300_000;
const GLOBAL_CAPACITY = 600_000;
const TENANT_REFILL = 150_000;
const TENANT_CAPACITY = 300_000;

interface Bucket {
  tokens: number;
  at: number | null;
}

/** A Redis that keeps the buckets the script keeps, and counts what it was asked. */
function bucketRedis(): RedisConnection & {
  evals: number;
  buckets: Map<string, Bucket>;
} {
  const buckets = new Map<string, Bucket>();
  const bucket = (key: string, capacity: number): Bucket => {
    let state = buckets.get(key);
    if (!state) {
      state = { tokens: capacity, at: null };
      buckets.set(key, state);
    }
    return state;
  };
  const refilled = (
    state: Bucket,
    now: number,
    capacity: number,
    refill: number,
  ) => {
    state.at ??= now;
    state.tokens = Math.min(
      capacity,
      state.tokens + ((now - state.at) / 1000) * refill,
    );
    state.at = now;
    return state.tokens;
  };
  const fake = {
    evals: 0,
    buckets,
    async eval(
      _script: string,
      _keyCount: number,
      globalKey: string,
      tenantKey: string,
      ...args: string[]
    ) {
      fake.evals += 1;
      const [
        now,
        wanted,
        _ttl,
        globalCapacity,
        globalRefill,
        tenantCapacity,
        tenantRefill,
      ] = args.map(Number) as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      const global = bucket(globalKey, globalCapacity);
      const tenant = bucket(tenantKey, tenantCapacity);
      const globalTokens = refilled(global, now, globalCapacity, globalRefill);
      const tenantTokens = refilled(tenant, now, tenantCapacity, tenantRefill);
      const waitFor = (tokens: number, refill: number) =>
        tokens >= wanted ? 0 : Math.ceil(((wanted - tokens) / refill) * 1000);
      const wait = Math.max(
        waitFor(globalTokens, globalRefill),
        waitFor(tenantTokens, tenantRefill),
      );
      if (wait > 0) return [0, wait];
      global.tokens -= wanted;
      tenant.tokens -= wanted;
      return [wanted, 0];
    },
  };
  return fake as unknown as RedisConnection & {
    evals: number;
    buckets: Map<string, Bucket>;
  };
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
    tokensPerSecond: GLOBAL_REFILL,
    capacity: GLOBAL_CAPACITY,
    tenantTokensPerSecond: TENANT_REFILL,
    tenantCapacity: TENANT_CAPACITY,
    now: () => clock.now,
    sleep: async (ms) => {
      clock.now += ms;
    },
  });
}

const globalBucket = (redis: ReturnType<typeof bucketRedis>) =>
  [...redis.buckets.entries()].find(([key]) => !key.includes(":tenant:"))?.[1];
const tenantBucket = (redis: ReturnType<typeof bucketRedis>, tenant: string) =>
  [...redis.buckets.entries()].find(([key]) =>
    key.endsWith(`:tenant:${tenant}`),
  )?.[1];

/** The `{...}` segment Redis Cluster hashes a key's slot from, if it has one. */
const hashTagOf = (key: string): string | undefined =>
  /\{[^}]+\}/.exec(key)?.[0];

describe("given the shared buckets", () => {
  describe("when the two buckets are keyed", () => {
    /** @scenario "Both buckets share one Redis Cluster hash tag" */
    it("puts both keys under one hash tag, so one EVAL may take from both", async () => {
      const redis = bucketRedis();
      const limiter = limiterOn({ redis, clock: { now: 1_000 } });

      await limiter.acquire({ tokens: 100, tenantId: "project-a" });

      // A multi-key EVAL on a cluster is refused with CROSSSLOT unless every
      // key hashes to the same slot, and the tag is what makes that so.
      // Refused, the limiter would fall back to the local rate on every call
      // and each pod would pace itself alone.
      const keys = [...redis.buckets.keys()];
      expect(keys).toHaveLength(2);
      const tags = keys.map(hashTagOf);
      expect(tags[0]).toBeDefined();
      expect(tags[1]).toBe(tags[0]);
    });
  });

  describe("when a classification takes its tokens", () => {
    /** @scenario "A classification takes its estimated tokens from one bucket shared by every pod" */
    it("debits the global bucket and the tenant's by exactly what it asked", async () => {
      const redis = bucketRedis();
      const limiter = limiterOn({ redis, clock: { now: 1_000 } });

      await limiter.acquire({ tokens: 4_200, tenantId: "project-a" });
      await limiter.acquire({ tokens: 800, tenantId: "project-b" });

      expect(redis.evals).toBe(2);
      expect(globalBucket(redis)?.tokens).toBe(GLOBAL_CAPACITY - 5_000);
      expect(tenantBucket(redis, "project-a")?.tokens).toBe(
        TENANT_CAPACITY - 4_200,
      );
      expect(tenantBucket(redis, "project-b")?.tokens).toBe(
        TENANT_CAPACITY - 800,
      );
    });
  });

  describe("when the global bucket is empty", () => {
    /** @scenario "An empty bucket refills at the configured token rate" */
    it("waits, and the wait is what makes the next tokens available", async () => {
      const redis = bucketRedis();
      const clock = { now: 1_000 };
      const limiter = limiterOn({ redis, clock });

      // Two tenants drain the whole global capacity between them without
      // either exhausting its own share, then one asks for more.
      await limiter.acquire({ tokens: TENANT_CAPACITY, tenantId: "a" });
      await limiter.acquire({ tokens: TENANT_CAPACITY, tenantId: "b" });
      const startedAt = clock.now;
      await limiter.acquire({ tokens: 30_000, tenantId: "c" });

      // Thirty thousand tokens at three hundred thousand a second is a
      // tenth of a second, taken in sleeps capped at a quarter second.
      expect(clock.now - startedAt).toBeGreaterThanOrEqual(100);
      expect(clock.now - startedAt).toBeLessThanOrEqual(250);
    });
  });

  describe("when one tenant has spent its share", () => {
    /** @scenario "A tenant that has spent its share waits while another tenant does not" */
    it("makes that tenant wait and lets another through", async () => {
      const redis = bucketRedis();
      const clock = { now: 1_000 };
      const limiter = limiterOn({ redis, clock });

      await limiter.acquire({ tokens: TENANT_CAPACITY, tenantId: "busy" });
      const before = clock.now;
      await limiter.acquire({ tokens: 1_000, tenantId: "quiet" });
      expect(clock.now).toBe(before);

      await limiter.acquire({ tokens: 1_000, tenantId: "busy" });
      expect(clock.now).toBeGreaterThan(before);
    });
  });

  describe("when the bucket has been idle", () => {
    /** @scenario "The bucket never fills past its capacity" */
    it("never holds more than its capacity", async () => {
      const redis = bucketRedis();
      const clock = { now: 1_000 };
      const limiter = limiterOn({ redis, clock });

      clock.now += 3_600_000;
      await limiter.acquire({ tokens: 1, tenantId: "a" });

      expect(globalBucket(redis)?.tokens).toBe(GLOBAL_CAPACITY - 1);
      expect(tenantBucket(redis, "a")?.tokens).toBe(TENANT_CAPACITY - 1);
    });
  });

  describe("when a request asks for more than a bucket can ever hold", () => {
    it("is let through at the capacity rather than waiting forever", async () => {
      const redis = bucketRedis();
      const clock = { now: 1_000 };
      const limiter = limiterOn({ redis, clock });

      await limiter.acquire({ tokens: TENANT_CAPACITY * 3, tenantId: "a" });

      expect(tenantBucket(redis, "a")?.tokens).toBe(0);
    });
  });
});

describe("given a Redis that cannot be reached", () => {
  describe("when tokens are asked for", () => {
    /** @scenario "A Redis that cannot be reached falls back to a local token rate" */
    it("grants them locally rather than failing the query", async () => {
      const failing = {
        async eval() {
          throw new Error("connection refused");
        },
      } as unknown as RedisConnection;
      const clock = { now: 1_000 };
      const limiter = limiterOn({ redis: failing, clock });

      // Twice the local rate: the first second's worth is the bucket's own
      // burst, and the second has to be waited for.
      for (let taken = 0; taken < 20; taken++) {
        await limiter.acquire({
          tokens: LOCAL_FALLBACK_TOKENS_PER_SECOND / 10,
          tenantId: "a",
        });
      }
      expect(clock.now - 1_000).toBeGreaterThanOrEqual(900);
    });
  });
});
