import IORedis, { type Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import { LEGACY_HOLDER_LEASE_GUARD } from "../blobConstants";
import { BlobLeases } from "../blobLeases";

const QUEUE_NAME = "{test/leases}";
const PREFIX = `${QUEUE_NAME}:gq:`;
const PROJECT = createTenantId("proj-1");
const HASH = "abc123hash";
const BLOB_KEY = `${PREFIX}blob:${PROJECT}/${HASH}`;
const LEASE_KEY = `${PREFIX}blobleases:${PROJECT}/${HASH}`;
const LEGACY_HOLDER_KEY = `${PREFIX}blobholders:${PROJECT}/${HASH}`;

let redis: Redis;
let leases: BlobLeases;

async function clearSuiteKeys() {
  const keys = await redis.keys(`${PREFIX}*`);
  if (keys.length > 0) await redis.del(...keys);
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
        });
        const firstDeadline = Number(await redis.zscore(LEASE_KEY, "slot-1"));

        await leases.take({
          projectId: PROJECT,
          hash: HASH,
          holderId: "slot-1",
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
        });

        await leases.release({
          projectId: PROJECT,
          hash: HASH,
          holderId: "slot-1",
        });
        await leases.release({
          projectId: PROJECT,
          hash: HASH,
          holderId: "slot-1",
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
          await leases.take({ projectId: PROJECT, hash: HASH, holderId });
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
          await leases.take({ projectId: PROJECT, hash: HASH, holderId });
        }
        await redis.zadd(
          LEASE_KEY,
          Date.now() - 1,
          "crashed-1",
          Date.now() - 1,
          "crashed-2",
        );

        await leases.renew({
          projectId: PROJECT,
          hash: HASH,
          holderId: "live",
        });

        expect(await leases.countLive({ projectId: PROJECT, hash: HASH })).toBe(
          1,
        );
        expect(await redis.zrange(LEASE_KEY, 0, -1)).toEqual(["live"]);
        expect(await redis.exists(BLOB_KEY)).toBe(1);
      });
    });
  });

  describe("given a holder dies without releasing", () => {
    describe("when its deadline passes", () => {
      it("expires the lease without requiring an exact release", async () => {
        await leases.take({ projectId: PROJECT, hash: HASH, holderId: "dead" });
        await redis.zadd(LEASE_KEY, Date.now() - 1, "dead");

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
        await leases.take({ projectId: PROJECT, hash: HASH, holderId: "old" });

        await leases.transfer({
          newProjectId: PROJECT,
          newHash: HASH,
          newHolderId: "new",
          oldProjectId: PROJECT,
          oldHash: HASH,
          oldHolderId: "old",
        });

        expect(await redis.zrange(LEASE_KEY, 0, -1)).toEqual(["new"]);
        expect(await redis.exists(BLOB_KEY)).toBe(1);
      });
    });
  });

  describe("given a rolling deploy with old holder-release code", () => {
    describe("when a new lease is taken", () => {
      it("guards the legacy holder set from eager last-release deletion", async () => {
        await leases.take({
          projectId: PROJECT,
          hash: HASH,
          holderId: "slot-1",
        });

        expect(await redis.smembers(LEGACY_HOLDER_KEY)).toEqual(
          expect.arrayContaining(["slot-1", LEGACY_HOLDER_LEASE_GUARD]),
        );
      });
    });
  });
});
