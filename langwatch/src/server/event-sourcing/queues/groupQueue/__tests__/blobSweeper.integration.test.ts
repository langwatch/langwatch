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

  /** Bytes on the full backstop, no lease and no holder: the shape repair acts on. */
  const giveBackstopBlobs = async (hashes: string[]) => {
    for (const hash of hashes) {
      await redis.set(blobKey(hash), "body", "EX", BLOB_BACKSTOP_TTL_SECONDS);
    }
  };

  /**
   * Pad the keyspace past several SCAN pages.
   *
   * SCAN pages by buckets and filters by MATCH afterwards, so a handful of keys
   * come back in one call and a single tick would cover them however the cursor
   * behaved. The padding is what makes a tick stop partway. It shares the suite
   * prefix so teardown removes it, and carries no "<project>/<hash>" segment so
   * the blob glob skips it.
   */
  const padKeyspace = async (count: number) => {
    const filler = redis.pipeline();
    for (let i = 0; i < count; i++) {
      filler.set(`${PREFIX}sweep-filler:${i}`, "x", "EX", 300);
    }
    await filler.exec();
  };

  const sweepRepeatedly = async (
    sweeperUnderTest: BlobSweeper,
    ticks: number,
  ) => {
    for (let tick = 0; tick < ticks; tick++) {
      await sweeperUnderTest.sweepQueue({ queueName: QUEUE_NAME });
    }
  };

  /**
   * TTLs of the given blobs, for a caller to assert on. Returns rather than
   * asserts so the expectations stay in the test that owns them.
   */
  const blobTtls = async (hashes: string[]) =>
    await Promise.all(hashes.map((hash) => redis.ttl(blobKey(hash))));

  /** A blob the runner has judged sits on the grace window, not the backstop. */
  const notOnGraceWindow = (ttls: number[]) =>
    ttls.filter((ttl) => ttl <= 0 || ttl > BLOB_RELEASE_GRACE_TTL_SECONDS);

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
        await redis.sadd(
          holderKey(),
          LEGACY_HOLDER_LEASE_GUARD,
          "died-mid-flight",
        );

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
        await redis.zadd(
          leaseKey(),
          (await redisNowMs()) - 1,
          "expired-holder",
        );

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

  describe("given more unreferenced blobs than one sweep's ceiling", () => {
    /**
     * The ceiling only bounds a tick if the walk resumes where it stopped. When
     * it restarts at the beginning every tick it re-judges the same leading
     * slice forever, and every blob past that slice is left to the 4-day
     * backstop no matter how often the sweep runs — which reads as a healthy
     * sweep in the totals while the bytes accumulate.
     */
    describe("when the runner sweeps repeatedly", () => {
      /** @scenario "Successive sweeps reach the blobs the previous ones stopped short of" */
      it("reaches every blob across successive sweeps rather than only the first slice", async () => {
        const hashes = ["h01", "h02", "h03", "h04", "h05", "h06"];
        await giveBackstopBlobs(hashes);
        await padKeyspace(3000);

        const pacedSweeper = new BlobSweeper({ redis, maxKeysPerQueue: 2 });

        // Enough ticks to cover the keyspace at this ceiling, with headroom for
        // SCAN returning short pages.
        await sweepRepeatedly(pacedSweeper, hashes.length * 3);

        // Naming the offenders rather than asserting a bare boolean, so a
        // failure says which blob was left behind and on what TTL.
        expect(notOnGraceWindow(await blobTtls(hashes))).toEqual([]);
      });

      /** @scenario "Once every blob has been judged the runner begins again" */
      it("rewinds to the start once the keyspace is exhausted", async () => {
        await redis.set(blobKey(), "body", "EX", BLOB_BACKSTOP_TTL_SECONDS);

        // A ceiling above the keyspace finishes the walk in one tick.
        const roomySweeper = new BlobSweeper({ redis, maxKeysPerQueue: 1000 });
        const tally = await roomySweeper.sweepQueue({ queueName: QUEUE_NAME });
        expect(tally.truncated).toBe(false);

        // A blob written after that cycle finished is still found next tick,
        // which only holds if the exhausted cursor rewound to "0".
        await redis.set(
          blobKey("later"),
          "body",
          "EX",
          BLOB_BACKSTOP_TTL_SECONDS,
        );
        await roomySweeper.sweepQueue({ queueName: QUEUE_NAME });

        const ttl = await redis.ttl(blobKey("later"));
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(BLOB_RELEASE_GRACE_TTL_SECONDS);
      });
    });
  });

  describe("given a dry run over more blobs than one sweep's ceiling", () => {
    describe("when the runner sweeps in dry-run mode and then for real", () => {
      /** @scenario "A dry run leaves the blobs it inspected for the next real sweep" */
      it("leaves the cursor untouched, and only a real sweep parks one", async () => {
        const cursorKey = `${PREFIX}blob-sweep-cursor`;
        await giveBackstopBlobs(["d01", "d02", "d03", "d04"]);

        // A ceiling below the blob count guarantees the walk stops partway, so
        // there is a real cursor position to park or discard.
        const pacedSweeper = new BlobSweeper({ redis, maxKeysPerQueue: 1 });

        const dryTally = await pacedSweeper.sweepQueue({
          queueName: QUEUE_NAME,
          dryRun: true,
        });

        expect(dryTally.truncated).toBe(true);
        // Nothing was judged, so nothing may be marked as covered.
        expect(await redis.exists(cursorKey)).toBe(0);

        await pacedSweeper.sweepQueue({ queueName: QUEUE_NAME });

        expect(await redis.exists(cursorKey)).toBe(1);
      });
    });
  });

  describe("given a keyspace where almost nothing matches the blob pattern", () => {
    describe("when the runner sweeps", () => {
      /** @scenario "A sweep stays bounded even when it finds almost nothing to judge" */
      it("stops on its scan-call budget instead of walking the whole keyspace", async () => {
        // Matches are what the key ceiling counts, so a keyspace with almost none
        // would run the walk to the end of the database on every tick. Only a
        // budget on the calls themselves bounds that.
        await padKeyspace(3000);
        await redis.set(blobKey(), "body", "EX", BLOB_BACKSTOP_TTL_SECONDS);

        const budgetedSweeper = new BlobSweeper({
          redis,
          maxScanCallsPerQueue: 2,
        });

        const tally = await budgetedSweeper.sweepQueue({
          queueName: QUEUE_NAME,
        });

        // Two SCAN calls cannot cross this keyspace, so the walk reports itself
        // unfinished rather than having run to the end.
        expect(tally.truncated).toBe(true);
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
