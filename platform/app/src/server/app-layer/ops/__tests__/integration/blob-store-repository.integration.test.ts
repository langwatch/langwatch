import { blobKeys, blobRef } from "@langwatch/groupqueue";
import type { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  getTestRedisConnection,
  startTestContainers,
  stopTestContainers,
} from "~/test-utils/integration/testContainers";
import { BlobStoreRedisRepository } from "../../repositories/blob-store.redis.repository";

const hasTestcontainers = !!(process.env.REDIS_URL || process.env.CI_REDIS_URL);

const PROJECT = "project-blobrepo";
const HASH = "blobrepohash01";

/**
 * The operator delete path against a live Redis. The point under test is the
 * holder guard: it lives inside the delete script, so a job that puts this exact
 * content between "is it referenced?" and "delete it" is refused by the same
 * eval that would have removed the blob — the check-then-act race a Node-side
 * guard would leave open.
 */
describe.skipIf(!hasTestcontainers)("BlobStoreRedisRepository delete", () => {
  let redis: Redis;
  let repo: BlobStoreRedisRepository;

  const keys = blobKeys(blobRef(PROJECT, HASH));

  const clearKeys = async () => {
    await redis.del(keys.meta, keys.data);
  };

  beforeAll(async () => {
    await startTestContainers();
    redis = getTestRedisConnection()!;
    repo = new BlobStoreRedisRepository(redis);
  });

  afterEach(clearKeys);

  afterAll(async () => {
    await clearKeys();
    await stopTestContainers();
  });

  describe("given a blob nothing holds", () => {
    describe("when an operator deletes it", () => {
      it("removes the bytes and reports the delete", async () => {
        await redis.hset(keys.meta, "refcount", 0, "tier", "redis");
        await redis.set(keys.data, "body");

        const result = await repo.deleteOne({
          projectId: PROJECT,
          hash: HASH,
        });

        expect(result).toEqual({ deleted: true, refusedHolders: 0 });
        expect(await redis.exists(keys.data)).toBe(0);
        expect(await redis.exists(keys.meta)).toBe(0);
      });
    });
  });

  describe("given a blob a holder still references", () => {
    describe("when an operator deletes it", () => {
      it("refuses atomically and leaves the bytes in place", async () => {
        await redis.hset(keys.meta, "refcount", 2, "tier", "redis");
        await redis.set(keys.data, "body");

        const result = await repo.deleteOne({
          projectId: PROJECT,
          hash: HASH,
        });

        expect(result).toEqual({ deleted: false, refusedHolders: 2 });
        expect(await redis.exists(keys.data)).toBe(1);
      });
    });
  });

  describe("given a blob that has already expired", () => {
    describe("when an operator deletes it", () => {
      it("reports no delete without claiming a holder refusal", async () => {
        const result = await repo.deleteOne({
          projectId: PROJECT,
          hash: HASH,
        });

        expect(result).toEqual({ deleted: false, refusedHolders: 0 });
      });
    });
  });

  describe("given a spooled blob", () => {
    describe("when it is fetched by id", () => {
      it("reports its tier, holders and remaining backstop", async () => {
        await redis.hset(keys.meta, "refcount", 1, "tier", "redis");
        await redis.expire(keys.meta, 3600);
        await redis.set(keys.data, "body");

        const summary = await repo.findById({
          projectId: PROJECT,
          hash: HASH,
        });

        expect(summary).toMatchObject({
          projectId: PROJECT,
          hash: HASH,
          tier: "redis",
          holders: 1,
          sizeBytes: 4,
        });
        expect(summary?.ttlSeconds).toBeGreaterThan(0);
      });
    });
  });

  describe("given a blob whose body was offloaded to the durable store", () => {
    describe("when it is fetched by id", () => {
      it("reports the durable tier rather than a zero-byte redis blob", async () => {
        await redis.hset(keys.meta, "refcount", 1, "tier", "durable");

        const summary = await repo.findById({
          projectId: PROJECT,
          hash: HASH,
        });

        expect(summary?.tier).toBe("durable");
        expect(summary?.sizeBytes).toBe(0);
      });
    });
  });
});
