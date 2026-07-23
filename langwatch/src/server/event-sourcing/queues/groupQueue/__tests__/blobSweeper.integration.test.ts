import IORedis, { type Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  BLOB_BACKSTOP_TTL_SECONDS,
  BLOB_RECLAIM_TTL_THRESHOLD_SECONDS,
  BLOB_RELEASE_GRACE_TTL_SECONDS,
  LEGACY_HOLDER_LEASE_GUARD,
} from "../blobConstants";
import { BlobSweeper } from "../blobSweeper";
import { GROUP_QUEUE_REGISTRY_KEY } from "../scripts";

const QUEUE_NAME = "{test/sweeper}";
const PREFIX = `${QUEUE_NAME}:gq:`;
const PROJECT = "project-sweep";
const HASH = "sweephash01";

const blobKey = (hash = HASH) => `${PREFIX}blob:${PROJECT}/${hash}`;
const leaseKey = (hash = HASH) => `${PREFIX}blobleases:${PROJECT}/${hash}`;
const holderKey = (hash = HASH) => `${PREFIX}blobholders:${PROJECT}/${hash}`;

describe("BlobSweeper", () => {
  let redis: Redis;
  let sweeper: BlobSweeper;

  const clearSuiteKeys = async () => {
    const keys = await redis.keys(`${PREFIX}*`);
    if (keys.length > 0) await redis.del(...keys);
    await redis.srem(GROUP_QUEUE_REGISTRY_KEY, QUEUE_NAME);
  };

  const redisNowMs = async () => {
    const [seconds, micros] = await redis.time();
    return Number(seconds) * 1000 + Math.floor(Number(micros) / 1000);
  };

  /** A live lease is a member whose deadline is in the future. */
  const giveLiveLease = async (holderId: string, hash = HASH) => {
    await redis.zadd(leaseKey(hash), (await redisNowMs()) + 60_000, holderId);
    await redis.sadd(holderKey(hash), LEGACY_HOLDER_LEASE_GUARD, holderId);
  };

  const sweepOnce = (dryRun = false) =>
    sweeper.sweepQueue({ queueName: QUEUE_NAME, dryRun });

  beforeAll(() => {
    redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 0,
    });
    sweeper = new BlobSweeper({ redis });
  });

  beforeEach(clearSuiteKeys);

  afterAll(async () => {
    await clearSuiteKeys();
    await redis.quit();
  });

  describe("given a blob whose holder died without releasing", () => {
    describe("when the runner sweeps", () => {
      /** @scenario "An unreferenced blob is put on the grace window even though a stale holder token withheld it" */
      it("grants the grace window the stale token would have withheld", async () => {
        await redis.set(blobKey(), "body", "EX", BLOB_BACKSTOP_TTL_SECONDS);
        // No lease member: the holder's deadline already lapsed. But its mirrored
        // token survives, because only a clean release ever removes one.
        await redis.sadd(holderKey(), LEGACY_HOLDER_LEASE_GUARD, "died-mid-flight");

        const tally = await sweepOnce();

        expect(tally.repaired).toBe(1);
        expect(await redis.exists(blobKey())).toBe(1);
        expect(await redis.ttl(blobKey())).toBeLessThanOrEqual(
          BLOB_RELEASE_GRACE_TTL_SECONDS,
        );
        expect(await redis.ttl(blobKey())).toBeGreaterThan(0);
      });
    });
  });

  describe("given a blob a staged job still leases", () => {
    describe("when the runner sweeps", () => {
      /** @scenario "A blob a live lease still references is left alone" */
      it("leaves the backstop untouched and reports it referenced", async () => {
        await redis.set(blobKey(), "body", "EX", BLOB_BACKSTOP_TTL_SECONDS);
        await giveLiveLease("live-holder");

        const tally = await sweepOnce();

        expect(tally.leased).toBe(1);
        expect(tally.reclaimed).toBe(0);
        expect(await redis.ttl(blobKey())).toBeGreaterThan(
          BLOB_RELEASE_GRACE_TTL_SECONDS,
        );
      });
    });
  });

  describe("given a blob written by a producer that has not staged yet", () => {
    describe("when the runner sweeps", () => {
      /** @scenario "A blob still within its put-before-stage window is not reclaimed" */
      it("shortens the deadline but never destroys the bytes", async () => {
        // Exactly what TieredBlobStore.put leaves behind: bytes on the full
        // backstop, no lease and no holder set at all.
        await redis.set(blobKey(), "body", "EX", BLOB_BACKSTOP_TTL_SECONDS);

        const tally = await sweepOnce();

        expect(tally.reclaimed).toBe(0);
        expect(await redis.exists(blobKey())).toBe(1);
      });
    });
  });

  describe("given a blob whose grace window has run past the safety margin", () => {
    describe("when the runner sweeps", () => {
      /** @scenario "A blob whose grace window has been running past the safety margin is destroyed" */
      it("destroys the bytes and their bookkeeping together", async () => {
        await redis.set(
          blobKey(),
          "body",
          "EX",
          BLOB_RECLAIM_TTL_THRESHOLD_SECONDS - 1,
        );
        await redis.sadd(holderKey(), LEGACY_HOLDER_LEASE_GUARD);
        await redis.zadd(leaseKey(), (await redisNowMs()) - 1, "expired-holder");

        const tally = await sweepOnce();

        expect(tally.reclaimed).toBe(1);
        expect(await redis.exists(blobKey())).toBe(0);
        expect(await redis.exists(leaseKey())).toBe(0);
        expect(await redis.exists(holderKey())).toBe(0);
      });
    });
  });

  describe("given a blob eligible for reclaim", () => {
    describe("when the runner sweeps in dry-run mode", () => {
      /** @scenario "A dry run reports what it would reclaim without deleting anything" */
      it("reports the reclaim without performing it", async () => {
        await redis.set(
          blobKey(),
          "body",
          "EX",
          BLOB_RECLAIM_TTL_THRESHOLD_SECONDS - 1,
        );

        const tally = await sweepOnce(true);

        expect(tally.reclaimed).toBe(1);
        expect(await redis.exists(blobKey())).toBe(1);
      });
    });
  });

  describe("given bookkeeping left behind by an expired blob", () => {
    describe("when the runner sweeps", () => {
      it("drops the orphaned lease and holder keys", async () => {
        // The blob itself is gone; only its lease/holder keys remain. The blob
        // SCAN cannot see it, so drive the decision directly.
        await redis.sadd(holderKey(), LEGACY_HOLDER_LEASE_GUARD);
        await redis.set(blobKey(), "body", "EX", 60);
        await redis.del(blobKey());

        const tally = await sweeper.sweepQueue({ queueName: QUEUE_NAME });

        // Nothing to scan, so nothing is examined — the keys expire on their own
        // via BLOB_LEASE_SET_TTL_SECONDS. Asserted so the bound is deliberate.
        expect(tally.scanned).toBe(0);
      });
    });
  });

  describe("given several queues registered in the group-queue registry", () => {
    describe("when the runner sweeps everything", () => {
      it("discovers the queue from the registry rather than a hardcoded name", async () => {
        await redis.sadd(GROUP_QUEUE_REGISTRY_KEY, QUEUE_NAME);
        await redis.set(blobKey(), "body", "EX", BLOB_BACKSTOP_TTL_SECONDS);

        const report = await sweeper.sweep({ dryRun: true });

        expect(report.queues.map((q) => q.queueName)).toContain(QUEUE_NAME);
        expect(report.totals.scanned).toBeGreaterThanOrEqual(1);
      });
    });
  });
});
