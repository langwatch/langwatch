import IORedis, { type Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { RedisJobBlobStore } from "../redisJobBlobStore";

// Self-contained: connects to the dev/CI Redis directly (no testcontainers /
// globalSetup, since this exercises only the blob key + its TTL). Scoped to a
// dedicated hash-tagged prefix so it never touches the shared dev stack's keys.
const QUEUE_NAME = "{test/blobstore}";
const BLOB_PREFIX = `${QUEUE_NAME}:gq:blob:`;
// GQ1 has no refcount, so a staged-but-not-yet-dispatched job (long retry
// backoff, paused pipeline, delayed schedule) sees no read between put and TTL
// tick-down — the backstop must comfortably outlive that residence, so it's
// 7 days, not 4. GQ2 (content-addressed, refcounted) uses the shorter 4-day
// number.
const GQ1_SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

let redis: Redis;
let store: RedisJobBlobStore;

async function clearSuiteKeys() {
  const keys = await redis.keys(`${BLOB_PREFIX}*`);
  if (keys.length > 0) await redis.del(...keys);
}

beforeAll(() => {
  redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: 0,
  });
});

beforeEach(async () => {
  await clearSuiteKeys();
  store = new RedisJobBlobStore({ redis, queueName: QUEUE_NAME });
});

afterAll(async () => {
  await clearSuiteKeys();
  await redis.quit();
});

describe("RedisJobBlobStore", () => {
  describe("given a stored blob", () => {
    describe("when it is read", () => {
      it("returns the bytes", async () => {
        await store.put({ id: "proj/abc", data: Buffer.from("hello") });

        expect(await store.get({ id: "proj/abc" })).toEqual(
          Buffer.from("hello"),
        );
      });

      it("refreshes the TTL toward the backstop on access", async () => {
        await store.put({ id: "proj/ttl", data: Buffer.from("payload") });
        // Shrink the TTL, then read: get() must bump it back via GETEX.
        await redis.expire(`${BLOB_PREFIX}proj/ttl`, 100);

        await store.get({ id: "proj/ttl" });

        const ttl = await redis.ttl(`${BLOB_PREFIX}proj/ttl`);
        expect(ttl).toBeGreaterThan(100);
        expect(ttl).toBeLessThanOrEqual(GQ1_SEVEN_DAYS_SECONDS);
      });

      it("sets the backstop TTL on put", async () => {
        await store.put({ id: "proj/fresh", data: Buffer.from("x") });

        const ttl = await redis.ttl(`${BLOB_PREFIX}proj/fresh`);
        expect(ttl).toBeGreaterThan(GQ1_SEVEN_DAYS_SECONDS - 60);
        expect(ttl).toBeLessThanOrEqual(GQ1_SEVEN_DAYS_SECONDS);
      });
    });
  });

  describe("given a missing blob", () => {
    describe("when it is read", () => {
      it("returns null", async () => {
        expect(await store.get({ id: "proj/absent" })).toBeNull();
      });
    });
  });

  describe("given a stored blob", () => {
    describe("when it is deleted", () => {
      it("is gone on the next read", async () => {
        await store.put({ id: "proj/del", data: Buffer.from("bye") });

        await store.delete({ id: "proj/del" });

        expect(await store.get({ id: "proj/del" })).toBeNull();
      });
    });
  });
});
