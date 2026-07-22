import type { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createTenantId } from "../../../../event-sourcing/domain/tenantId";
import {
  startTestContainers,
  stopTestContainers,
  getTestRedisConnection,
} from "../../../../event-sourcing/__tests__/integration/testContainers";
import {
  blobHolderSetKey,
  blobLeaseSetKey,
  redisBlobKey,
} from "../../../../event-sourcing/queues/groupQueue/blobKeys";
import { LEGACY_HOLDER_LEASE_GUARD } from "../../../../event-sourcing/queues/groupQueue/blobConstants";
import { BlobStoreRedisRepository } from "../../repositories/blob-store.redis.repository";

const hasTestcontainers = !!(process.env.REDIS_URL || process.env.CI_REDIS_URL);

const QUEUE = "{test/blobrepo}";
const PROJECT = "project-blobrepo";
const HASH = "blobrepohash01";

/**
 * The operator delete path against a live Redis. The point under test is the
 * lease guard: it lives inside the delete script, so a job that acquires a
 * reference between "is it referenced?" and "delete it" is refused by the same
 * eval that would have removed the blob — the check-then-act race a Node-side
 * guard would leave open.
 */
describe.skipIf(!hasTestcontainers)("BlobStoreRedisRepository delete", () => {
  let redis: Redis;
  let repo: BlobStoreRedisRepository;

  const tenant = createTenantId(PROJECT);
  const keyArgs = { queueName: QUEUE, projectId: tenant, hash: HASH };
  const blobKey = redisBlobKey(keyArgs);
  const leaseKey = blobLeaseSetKey(keyArgs);
  const holderKey = blobHolderSetKey(keyArgs);

  const nowMs = async () => {
    const [seconds, micros] = await redis.time();
    return Number(seconds) * 1000 + Math.floor(Number(micros) / 1000);
  };

  const clearKeys = async () => {
    const keys = await redis.keys(`${QUEUE}*`);
    if (keys.length > 0) await redis.del(...keys);
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

  describe("given a blob nothing references", () => {
    describe("when an operator deletes it", () => {
      it("removes the bytes and reports the delete", async () => {
        await redis.set(blobKey, "body", "EX", 3600);

        const result = await repo.deleteOne({
          queueName: QUEUE,
          projectId: PROJECT,
          hash: HASH,
        });

        expect(result).toEqual({ deleted: true, refusedLiveLeases: 0 });
        expect(await redis.exists(blobKey)).toBe(0);
      });
    });
  });

  describe("given a blob a live lease still references", () => {
    describe("when an operator deletes it", () => {
      it("refuses atomically and leaves the bytes in place", async () => {
        await redis.set(blobKey, "body", "EX", 3600);
        // A live lease: a member whose deadline is in the future.
        await redis.zadd(leaseKey, (await nowMs()) + 60_000, "holder-a");
        await redis.sadd(holderKey, LEGACY_HOLDER_LEASE_GUARD, "holder-a");

        const result = await repo.deleteOne({
          queueName: QUEUE,
          projectId: PROJECT,
          hash: HASH,
        });

        expect(result).toEqual({ deleted: false, refusedLiveLeases: 1 });
        expect(await redis.exists(blobKey)).toBe(1);
      });
    });
  });

  describe("given a blob whose only lease deadline has already lapsed", () => {
    describe("when an operator deletes it", () => {
      it("prunes the dead lease and deletes, because a lapsed member is not a reference", async () => {
        await redis.set(blobKey, "body", "EX", 3600);
        await redis.zadd(leaseKey, (await nowMs()) - 60_000, "holder-dead");

        const result = await repo.deleteOne({
          queueName: QUEUE,
          projectId: PROJECT,
          hash: HASH,
        });

        expect(result).toEqual({ deleted: true, refusedLiveLeases: 0 });
        expect(await redis.exists(blobKey)).toBe(0);
      });
    });
  });

  describe("given a blob that has already expired", () => {
    describe("when an operator deletes it", () => {
      it("reports no delete without claiming a lease refusal", async () => {
        const result = await repo.deleteOne({
          queueName: QUEUE,
          projectId: PROJECT,
          hash: HASH,
        });

        expect(result).toEqual({ deleted: false, refusedLiveLeases: 0 });
      });
    });
  });

  describe("given a described blob", () => {
    describe("when it is fetched by id", () => {
      it("carries the sweep verdict the runner would reach for it", async () => {
        // Unreferenced with a long backstop: the sweep would shorten it.
        await redis.set(blobKey, "body", "EX", 4 * 24 * 3600);

        const summary = await repo.findById({
          queueName: QUEUE,
          projectId: PROJECT,
          hash: HASH,
        });

        expect(summary?.sweepOutcome).toBe("repaired");
        expect(summary?.liveLeases).toBe(0);
      });
    });
  });
});
