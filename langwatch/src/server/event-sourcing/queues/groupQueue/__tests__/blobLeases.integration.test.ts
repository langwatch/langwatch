import IORedis, { type Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import {
  BLOB_BACKSTOP_TTL_SECONDS,
  BLOB_RELEASE_GRACE_TTL_SECONDS,
  LEGACY_HOLDER_LEASE_GUARD,
} from "../blobConstants";
import { BlobLeases } from "../blobLeases";

const QUEUE_NAME = "{test/leases}";
const PREFIX = `${QUEUE_NAME}:gq:`;
const PROJECT = createTenantId("proj-1");
const HASH = "abc123hash";
const BLOB_KEY = `${PREFIX}blob:${PROJECT}/${HASH}`;
const LEASE_KEY = `${PREFIX}blobleases:${PROJECT}/${HASH}`;
const LEGACY_HOLDER_KEY = `${PREFIX}blobholders:${PROJECT}/${HASH}`;

// Frozen from the pre-lease BlobHolders implementation. This is the old-code
// release path the migration guard must survive during a rolling deployment.
const LEGACY_RELEASE_LUA = `
if redis.call("SREM", KEYS[1], ARGV[1]) == 0 then return 0 end
if redis.call("SCARD", KEYS[1]) == 0 then
  redis.call("DEL", KEYS[1])
  if #KEYS >= 2 then
    redis.call("UNLINK", KEYS[2])
    return 1
  end
  return 2
end
return 0
`;

let redis: Redis;
let leases: BlobLeases;

async function clearSuiteKeys() {
  const keys = await redis.keys(`${PREFIX}*`);
  if (keys.length > 0) await redis.del(...keys);
}

async function redisNowMs(): Promise<number> {
  const [seconds, microseconds] = await redis.time();
  return Number(seconds) * 1000 + Math.floor(Number(microseconds) / 1000);
}

beforeAll(() => {
  redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: 0,
  });
});

beforeEach(async () => {
  await clearSuiteKeys();
  leases = new BlobLeases({ redis, queueName: QUEUE_NAME, leaseTtlSeconds: 1 });
});

afterAll(async () => {
  await clearSuiteKeys();
  await redis.quit();
});

describe("BlobLeases", () => {
  describe("given one holder takes the same lease twice", () => {
    describe("when live leases are inspected", () => {
      it("keeps one deadline for the holder and moves it forward", async () => {
        await leases.take({
          projectId: PROJECT,
          hash: HASH,
          holderId: "slot-1",
          tier: "redis",
        });
        const firstDeadline = Number(await redis.zscore(LEASE_KEY, "slot-1"));

        await leases.take({
          projectId: PROJECT,
          hash: HASH,
          holderId: "slot-1",
          tier: "redis",
        });
        const renewedDeadline = Number(await redis.zscore(LEASE_KEY, "slot-1"));

        expect(await redis.zcard(LEASE_KEY)).toBe(1);
        expect(renewedDeadline).toBeGreaterThanOrEqual(firstDeadline);
        expect(await leases.countLive({ projectId: PROJECT, hash: HASH })).toBe(
          1,
        );
      });
    });
  });

  describe("given a holder releases the same lease twice", () => {
    describe("when the blob is inspected", () => {
      it("treats both releases as idempotent and never deletes the blob", async () => {
        await redis.set(BLOB_KEY, "body");
        await leases.take({
          projectId: PROJECT,
          hash: HASH,
          holderId: "slot-1",
          tier: "redis",
        });

        await leases.release({
          projectId: PROJECT,
          hash: HASH,
          holderId: "slot-1",
          tier: "redis",
        });
        await leases.release({
          projectId: PROJECT,
          hash: HASH,
          holderId: "slot-1",
          tier: "redis",
        });

        expect(await leases.countLive({ projectId: PROJECT, hash: HASH })).toBe(
          0,
        );
        expect(await redis.exists(BLOB_KEY)).toBe(1);
      });
    });
  });

  describe("given three jobs share one content hash", () => {
    describe("when each job takes a lease", () => {
      it("records three lease identities beside one blob", async () => {
        await redis.set(BLOB_KEY, "one stored body");
        for (const holderId of ["slot-1", "slot-2", "slot-3"]) {
          await leases.take({
            projectId: PROJECT,
            hash: HASH,
            holderId,
            tier: "redis",
          });
        }

        expect(await redis.keys(`${PREFIX}blob:${PROJECT}/${HASH}`)).toEqual([
          BLOB_KEY,
        ]);
        expect(await leases.countLive({ projectId: PROJECT, hash: HASH })).toBe(
          3,
        );
      });
    });
  });

  describe("given one live lease and two expired sibling leases", () => {
    describe("when the live holder renews", () => {
      it("prunes the crashed holders and keeps the blob untouched", async () => {
        await redis.set(BLOB_KEY, "body", "EX", 10);
        for (const holderId of ["live", "crashed-1", "crashed-2"]) {
          await leases.take({
            projectId: PROJECT,
            hash: HASH,
            holderId,
            tier: "redis",
          });
        }
        await redis.zadd(
          LEASE_KEY,
          (await redisNowMs()) - 1,
          "crashed-1",
          (await redisNowMs()) - 1,
          "crashed-2",
        );

        await leases.renew({
          projectId: PROJECT,
          hash: HASH,
          holderId: "live",
          tier: "redis",
        });

        expect(await leases.countLive({ projectId: PROJECT, hash: HASH })).toBe(
          1,
        );
        expect(await redis.zrange(LEASE_KEY, 0, -1)).toEqual(["live"]);
        expect(await redis.exists(BLOB_KEY)).toBe(1);
        expect(await redis.ttl(BLOB_KEY)).toBeGreaterThan(10);
      });
    });
  });

  describe("given a holder dies without releasing", () => {
    describe("when its deadline passes", () => {
      it("expires the lease without requiring an exact release", async () => {
        await leases.take({
          projectId: PROJECT,
          hash: HASH,
          holderId: "dead",
          tier: "redis",
        });
        await redis.zadd(LEASE_KEY, (await redisNowMs()) - 1, "dead");

        expect(await leases.countLive({ projectId: PROJECT, hash: HASH })).toBe(
          0,
        );
        expect(await redis.exists(LEASE_KEY)).toBe(0);
      });
    });
  });

  describe("given a retry changes the holder identity", () => {
    describe("when its lease transfers", () => {
      it("takes the replacement lease and removes the retired lease atomically", async () => {
        await redis.set(BLOB_KEY, "body");
        await leases.take({
          projectId: PROJECT,
          hash: HASH,
          holderId: "old",
          tier: "redis",
        });

        await leases.transfer({
          newProjectId: PROJECT,
          newHash: HASH,
          newHolderId: "new",
          oldProjectId: PROJECT,
          oldHash: HASH,
          oldHolderId: "old",
          oldTier: "redis",
        });

        expect(await redis.zrange(LEASE_KEY, 0, -1)).toEqual(["new"]);
        expect(await redis.exists(BLOB_KEY)).toBe(1);
      });
    });
  });

  describe("given a rolling deploy with old holder-release code", () => {
    describe("when old code releases its last holder while a new lease exists", () => {
      it("keeps the blob and new lease alive behind the migration guard", async () => {
        await redis.set(BLOB_KEY, "body");
        await leases.take({
          projectId: PROJECT,
          hash: HASH,
          holderId: "slot-1",
          tier: "redis",
        });

        const outcome = await redis.eval(
          LEGACY_RELEASE_LUA,
          2,
          LEGACY_HOLDER_KEY,
          BLOB_KEY,
          "slot-1",
        );

        expect(outcome).toBe(0);
        expect(await redis.exists(BLOB_KEY)).toBe(1);
        expect(await redis.zscore(LEASE_KEY, "slot-1")).not.toBeNull();
        expect(await redis.smembers(LEGACY_HOLDER_KEY)).toEqual([
          LEGACY_HOLDER_LEASE_GUARD,
        ]);
      });
    });
  });

  // Track 5 of specs/event-sourcing/payload-store-content-addressed.feature.
  // The release grace window bounds how long a blob nobody references survives.
  describe("release grace window", () => {
    describe("given a Redis-tier blob whose only holder retires", () => {
      describe("when that holder releases its lease", () => {
        it("keeps the bytes and shortens the expiry to the grace window", async () => {
          await redis.set(BLOB_KEY, "body", "EX", BLOB_BACKSTOP_TTL_SECONDS);
          await leases.take({
            projectId: PROJECT,
            hash: HASH,
            holderId: "only",
            tier: "redis",
          });

          const graced = await leases.release({
            projectId: PROJECT,
            hash: HASH,
            holderId: "only",
            tier: "redis",
          });

          expect(graced).toBe(true);
          expect(await redis.exists(BLOB_KEY)).toBe(1);
          expect(await redis.ttl(BLOB_KEY)).toBeLessThanOrEqual(
            BLOB_RELEASE_GRACE_TTL_SECONDS,
          );
          expect(await redis.ttl(BLOB_KEY)).toBeGreaterThan(0);
        });
      });
    });

    describe("given a Redis-tier blob two jobs lease", () => {
      describe("when one of them releases", () => {
        it("withholds the grace window and keeps the full backstop", async () => {
          await redis.set(BLOB_KEY, "body", "EX", BLOB_BACKSTOP_TTL_SECONDS);
          for (const holderId of ["staying", "leaving"]) {
            await leases.take({
              projectId: PROJECT,
              hash: HASH,
              holderId,
              tier: "redis",
            });
          }

          const graced = await leases.release({
            projectId: PROJECT,
            hash: HASH,
            holderId: "leaving",
            tier: "redis",
          });

          expect(graced).toBe(false);
          expect(await redis.ttl(BLOB_KEY)).toBeGreaterThan(
            BLOB_RELEASE_GRACE_TTL_SECONDS,
          );
        });
      });
    });

    // Why shortening an expiry is safe where deleting the bytes was not: the
    // producer that wrote these bytes before the release stages after it, and
    // its take re-arms the backstop instead of finding a hole.
    describe("given a blob already on the grace window", () => {
      describe("when a job referencing the same content takes a lease", () => {
        it("restores the full backstop under the new holder", async () => {
          await redis.set(BLOB_KEY, "body", "EX", BLOB_BACKSTOP_TTL_SECONDS);
          await leases.take({
            projectId: PROJECT,
            hash: HASH,
            holderId: "retiring",
            tier: "redis",
          });
          await leases.release({
            projectId: PROJECT,
            hash: HASH,
            holderId: "retiring",
            tier: "redis",
          });

          await leases.take({
            projectId: PROJECT,
            hash: HASH,
            holderId: "arriving",
            tier: "redis",
          });

          expect(await redis.ttl(BLOB_KEY)).toBeGreaterThan(
            BLOB_RELEASE_GRACE_TTL_SECONDS,
          );
          expect(await leases.countLive({ projectId: PROJECT, hash: HASH })).toBe(
            1,
          );
        });
      });
    });

    describe("given a holder token written by a pre-lease release", () => {
      describe("when the last lease is released", () => {
        it("withholds the grace window because that holder has no deadline to read", async () => {
          await redis.set(BLOB_KEY, "body", "EX", BLOB_BACKSTOP_TTL_SECONDS);
          await leases.take({
            projectId: PROJECT,
            hash: HASH,
            holderId: "leased",
            tier: "redis",
          });
          await redis.sadd(LEGACY_HOLDER_KEY, "old-release-holder");

          const graced = await leases.release({
            projectId: PROJECT,
            hash: HASH,
            holderId: "leased",
            tier: "redis",
          });

          expect(graced).toBe(false);
          expect(await redis.ttl(BLOB_KEY)).toBeGreaterThan(
            BLOB_RELEASE_GRACE_TTL_SECONDS,
          );
        });
      });
    });

    describe("given a transfer retires the last lease on a different blob", () => {
      describe("when the lease moves to the replacement's content", () => {
        it("graces the displaced blob and leaves the replacement's backstop", async () => {
          const otherHash = "replacementhash";
          const otherBlobKey = `${PREFIX}blob:${PROJECT}/${otherHash}`;
          await redis.set(BLOB_KEY, "old body", "EX", BLOB_BACKSTOP_TTL_SECONDS);
          await redis.set(
            otherBlobKey,
            "new body",
            "EX",
            BLOB_BACKSTOP_TTL_SECONDS,
          );
          await leases.take({
            projectId: PROJECT,
            hash: HASH,
            holderId: "old",
            tier: "redis",
          });

          const graced = await leases.transfer({
            newProjectId: PROJECT,
            newHash: otherHash,
            newHolderId: "new",
            oldProjectId: PROJECT,
            oldHash: HASH,
            oldHolderId: "old",
            oldTier: "redis",
          });

          expect(graced).toBe(true);
          expect(await redis.exists(BLOB_KEY)).toBe(1);
          expect(await redis.ttl(BLOB_KEY)).toBeLessThanOrEqual(
            BLOB_RELEASE_GRACE_TTL_SECONDS,
          );
          expect(await redis.ttl(otherBlobKey)).toBeGreaterThan(
            BLOB_RELEASE_GRACE_TTL_SECONDS,
          );
        });
      });
    });

    describe("given a retry re-encodes to the same content hash", () => {
      describe("when the lease transfers within one lease set", () => {
        it("withholds the grace window because the replacement already holds it", async () => {
          await redis.set(BLOB_KEY, "body", "EX", BLOB_BACKSTOP_TTL_SECONDS);
          await leases.take({
            projectId: PROJECT,
            hash: HASH,
            holderId: "attempt-1",
            tier: "redis",
          });

          const graced = await leases.transfer({
            newProjectId: PROJECT,
            newHash: HASH,
            newHolderId: "attempt-2",
            oldProjectId: PROJECT,
            oldHash: HASH,
            oldHolderId: "attempt-1",
            oldTier: "redis",
          });

          expect(graced).toBe(false);
          expect(await redis.ttl(BLOB_KEY)).toBeGreaterThan(
            BLOB_RELEASE_GRACE_TTL_SECONDS,
          );
        });
      });
    });

    describe("given an S3-tier blob whose only holder retires", () => {
      describe("when that holder releases its lease", () => {
        it("graces the bookkeeping keys without touching any object store", async () => {
          await leases.take({
            projectId: PROJECT,
            hash: HASH,
            holderId: "only",
            tier: "s3",
          });

          const graced = await leases.release({
            projectId: PROJECT,
            hash: HASH,
            holderId: "only",
            tier: "s3",
          });

          expect(graced).toBe(true);
          expect(await redis.ttl(LEGACY_HOLDER_KEY)).toBeLessThanOrEqual(
            BLOB_RELEASE_GRACE_TTL_SECONDS,
          );
        });
      });
    });
  });
});
