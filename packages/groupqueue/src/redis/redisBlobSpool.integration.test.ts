import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  readTestRedisInfo,
  uniqueTenant,
} from "../__tests__/integration/testRedis";
import { BlobTooLargeError } from "../errors";
import type { DurableObjectStore } from "./redisBlobSpool";
import { redisBlobSpool } from "./redisBlobSpool";

function fakeDurableStore(): DurableObjectStore {
  const objects = new Map<string, string>();
  return {
    put: async (key, body) => {
      objects.set(key, body);
    },
    get: async (key) => objects.get(key) ?? null,
    delete: async (key) => {
      objects.delete(key);
    },
  };
}

// Content-addressing means the same tenant + body always resolves to the
// same ref. The container is `.withReuse()`d across runs, so every body
// below is salted with a fresh id — otherwise a leftover refcount from a
// previous run would make this run skip the durable-tier write.
function uniqueBody(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

describe("redisBlobSpool", () => {
  let redis: Redis;

  beforeAll(() => {
    const { url } = readTestRedisInfo();
    redis = new Redis(url);
  });

  afterAll(async () => {
    await redis.quit();
  });

  // Belt-and-braces alongside uniqueBody()/uniqueTenant(): the container is
  // `.withReuse()`d across runs, so nothing here should depend on starting
  // from an empty keyspace, but a clean slate keeps it that way.
  beforeEach(async () => {
    await redis.flushall();
  });

  describe("given a body larger than the spool's Redis-tier threshold", () => {
    /** @scenario A body larger than the inline threshold is stored and read back unchanged */
    it("is stored through the durable tier and read back byte-for-byte", async () => {
      const spool = redisBlobSpool(redis, {
        redisTierThresholdBytes: 16,
        durableStore: fakeDurableStore(),
      });
      const body = uniqueBody(`${"x".repeat(10_000)}héllo 🎉`);

      const ref = await spool.put(uniqueTenant(), body);
      const roundTripped = await spool.get(ref);

      expect(roundTripped).toBe(body);
    });
  });

  describe("given a body larger than the spool's hard size ceiling", () => {
    /** @scenario A body over the hard ceiling is refused */
    it("refuses it", async () => {
      const spool = redisBlobSpool(redis, { maxBytes: 100 });
      await expect(
        spool.put(uniqueTenant(), uniqueBody("x".repeat(200))),
      ).rejects.toThrow(BlobTooLargeError);
    });
  });

  describe("given a blob put into the spool by two holders", () => {
    /** @scenario A blob still held by another job is not deleted on release */
    it("is still readable after one holder releases it", async () => {
      const spool = redisBlobSpool(redis);
      const tenant = uniqueTenant();
      const body = uniqueBody("shared-payload");
      const refA = await spool.put(tenant, body);
      const refB = await spool.put(tenant, body);
      expect(refA).toBe(refB);

      await spool.release(refA);

      expect(await spool.get(refA)).toBe(body);
    });
  });

  describe("given a blob released by its only holder", () => {
    /** @scenario A released blob is still readable before its grace window elapses */
    it("is still readable before the grace window elapses", async () => {
      const spool = redisBlobSpool(redis, { graceSeconds: 60 });
      const body = uniqueBody("grace-window-payload");
      const ref = await spool.put(uniqueTenant(), body);

      await spool.release(ref);

      expect(await spool.get(ref)).toBe(body);
    });

    /** @scenario A released blob is reclaimed once its grace window elapses */
    it("is no longer readable once the grace window elapses", async () => {
      const spool = redisBlobSpool(redis, { graceSeconds: 1 });
      const body = uniqueBody("short-grace-payload");
      const ref = await spool.put(uniqueTenant(), body);

      await spool.release(ref);
      await new Promise((resolve) => setTimeout(resolve, 1200));

      expect(await spool.get(ref)).toBeNull();
    });
  });
});
