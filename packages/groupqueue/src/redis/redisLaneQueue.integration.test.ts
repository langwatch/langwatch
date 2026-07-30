import { randomUUID } from "node:crypto";
import type {
  ClaimedBatch,
  GroupKey,
  StagedJob,
} from "@langwatch/event-sourcing";
import { renderGroupKey } from "@langwatch/event-sourcing";
import Redis from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  readTestRedisInfo,
  uniqueLaneName,
  uniqueTenant,
} from "../__tests__/integration/testRedis";
import { redisBlobSpool } from "./redisBlobSpool";
import { redisLaneQueue } from "./redisLaneQueue";

/**
 * Fairness across lanes is out of scope here (scheduler.ts's job, no I/O —
 * dispatch-durability-and-fairness.feature). Every scenario below drives one
 * lane at a time, or two lanes only to prove they do not interfere.
 */

function descriptor(overrides: Partial<GroupKey> = {}): GroupKey {
  return {
    tenantId: uniqueTenant(),
    lane: { kind: "fold", name: uniqueLaneName("lane") },
    scope: {
      kind: "aggregate",
      aggregateType: "trace",
      aggregateId: uniqueLaneName("agg"),
    },
    ...overrides,
  };
}

function stagedJob(
  desc: GroupKey,
  overrides: Partial<StagedJob> = {},
): StagedJob {
  const body = overrides.body ?? '{"ok":true}';
  return {
    descriptor: desc,
    orderingKey: Date.now(),
    aggregateId:
      desc.scope.kind === "aggregate" ? desc.scope.aggregateId : "agg",
    eventType: "trace/spanReceived",
    eventId: randomUUID(),
    costBytes: Buffer.byteLength(body),
    body,
    ...overrides,
  };
}

describe("redisLaneQueue", () => {
  let redis: Redis;

  beforeAll(() => {
    const { url } = readTestRedisInfo();
    redis = new Redis(url);
  });

  afterAll(async () => {
    await redis.quit();
  });

  // The container is `.withReuse()`d across runs, and the lane registry
  // (LANE_REGISTRY_KEY) is never pruned by design (claim() has no lane
  // fairness to defer to here — see the module docblock above). Without a
  // clean slate, leftover claimable lanes from earlier runs pile up and
  // `claimSpecificLane`'s bounded scan can exhaust its budget before ever
  // reaching the lane a test actually cares about.
  beforeEach(async () => {
    await redis.flushall();
  });

  function queue(options?: Parameters<typeof redisLaneQueue>[2]) {
    const spool = redisBlobSpool(redis);
    return redisLaneQueue(redis, spool, options);
  }

  describe("given a job staged with a large body", () => {
    /** @scenario A job's header is stored apart from its body */
    it("reads the header back directly, without touching the body's own key", async () => {
      const q = queue();
      const desc = descriptor();
      // Bigger than the lane's own inline threshold (offloaded to the spool)
      // but smaller than the spool's own Redis-tier threshold, so no durable
      // store needs to be configured for this test.
      const bigBody = JSON.stringify({ data: "x".repeat(50_000) });
      await q.stage([
        stagedJob(desc, {
          body: bigBody,
          costBytes: Buffer.byteLength(bigBody),
        }),
      ]);

      const batch = (await q.claim({
        maxJobs: 10,
        maxBytes: 10_000_000,
        leaseMs: 30_000,
      })) as ClaimedBatch;
      expect(batch).not.toBeNull();
      expect(batch.jobs[0]?.header.sequence).toBe(1);
    });
  });

  describe("when two jobs are staged into the same lane", () => {
    /** @scenario Two jobs staged into one lane get increasing sequences */
    it("assigns the second a higher sequence than the first", async () => {
      const q = queue();
      const desc = descriptor();
      await q.stage([
        stagedJob(desc, { eventId: "evt-a" }),
        stagedJob(desc, { eventId: "evt-b" }),
      ]);

      const batch = (await q.claim({
        maxJobs: 10,
        maxBytes: 10_000_000,
        leaseMs: 30_000,
      })) as ClaimedBatch;
      const sequences = batch.jobs.map((job) => job.header.sequence);
      expect(sequences).toEqual([1, 2]);
    });
  });

  describe("when a job is staged into one lane and another into a different lane", () => {
    /** @scenario Two lanes do not share a sequence space */
    it("assigns each sequence one within its own lane", async () => {
      const q = queue();
      const laneA = descriptor();
      const laneB = descriptor();
      await q.stage([stagedJob(laneA), stagedJob(laneB)]);

      const batchA = (await q.claim({
        maxJobs: 10,
        maxBytes: 10_000_000,
        leaseMs: 30_000,
      })) as ClaimedBatch;
      const batchB = (await q.claim({
        maxJobs: 10,
        maxBytes: 10_000_000,
        leaseMs: 30_000,
      })) as ClaimedBatch;
      expect(batchA.jobs[0]?.header.sequence).toBe(1);
      expect(batchB.jobs[0]?.header.sequence).toBe(1);
    });
  });

  describe("given a job that has been staged and then claimed", () => {
    /** @scenario A retried job's header still carries its original sequence */
    it("carries the same sequence after a retry and re-claim", async () => {
      const q = queue();
      const desc = descriptor();
      await q.stage([stagedJob(desc)]);

      const first = (await q.claim({
        maxJobs: 10,
        maxBytes: 10_000_000,
        leaseMs: 30_000,
      })) as ClaimedBatch;
      const originalSequence = first.jobs[0]?.header.sequence;
      await q.retry(first.lease, 0);

      const second = (await q.claim({
        maxJobs: 10,
        maxBytes: 10_000_000,
        leaseMs: 30_000,
      })) as ClaimedBatch;
      expect(second.jobs[0]?.header.sequence).toBe(originalSequence);
    });
  });

  describe("given a job that has failed and been retried once already", () => {
    /** @scenario Backoff preserves the attempt across the retry chain */
    it("advances the attempt by one on each retry, not resetting it", async () => {
      const q = queue();
      const desc = descriptor();
      await q.stage([stagedJob(desc)]);

      const first = (await q.claim({
        maxJobs: 10,
        maxBytes: 10_000_000,
        leaseMs: 30_000,
      })) as ClaimedBatch;
      await q.retry(first.lease, 0);
      const second = (await q.claim({
        maxJobs: 10,
        maxBytes: 10_000_000,
        leaseMs: 30_000,
      })) as ClaimedBatch;
      expect(second.jobs[0]?.header.attempt).toBe(1);

      await q.retry(second.lease, 0);
      const third = (await q.claim({
        maxJobs: 10,
        maxBytes: 10_000_000,
        leaseMs: 30_000,
      })) as ClaimedBatch;
      expect(third.jobs[0]?.header.attempt).toBe(2);
    });
  });

  describe("given a lane whose only job has just been claimed", () => {
    /** @scenario A second claim on an already-leased lane is refused */
    it("refuses a second claim before the first is settled", async () => {
      const q = queue();
      const desc = descriptor();
      await q.stage([stagedJob(desc)]);

      const first = await q.claim({
        maxJobs: 10,
        maxBytes: 10_000_000,
        leaseMs: 30_000,
      });
      expect(first).not.toBeNull();

      const second = await claimSpecificLane(q, desc);
      expect(second).toBeNull();
    });
  });

  describe("given a lane whose job was retried once and then claimed under a short lease", () => {
    /** @scenario An expired lease's lane is claimable again without losing its attempt */
    it("is claimable again after the lease expires, with the attempt intact", async () => {
      const q = queue();
      const desc = descriptor();
      await q.stage([stagedJob(desc)]);

      const first = (await q.claim({
        maxJobs: 10,
        maxBytes: 10_000_000,
        leaseMs: 30_000,
      })) as ClaimedBatch;
      await q.retry(first.lease, 0);

      // Claim under a lease so short it is already stale by the time we look again.
      await q.claim({ maxJobs: 10, maxBytes: 10_000_000, leaseMs: 1 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      const reclaimed = await claimSpecificLane(q, desc, {
        maxJobs: 10,
        maxBytes: 10_000_000,
        leaseMs: 30_000,
      });
      expect(reclaimed).not.toBeNull();
      expect(reclaimed?.jobs[0]?.header.attempt).toBe(1);
    });
  });

  describe("given a lane holding more jobs than the requested count bound", () => {
    /** @scenario A claim stops at the configured job count */
    it("returns only the requested count", async () => {
      const q = queue();
      const desc = descriptor();
      await q.stage(
        [1, 2, 3, 4, 5].map((n) => stagedJob(desc, { eventId: `evt-${n}` })),
      );

      const batch = (await q.claim({
        maxJobs: 2,
        maxBytes: 10_000_000,
        leaseMs: 30_000,
      })) as ClaimedBatch;
      expect(batch.jobs).toHaveLength(2);
    });
  });

  describe("given a lane holding several jobs whose combined size exceeds a byte bound", () => {
    /** @scenario A claim stops short of the byte bound rather than exceeding it */
    it("stops the batch short of the byte bound", async () => {
      const q = queue();
      const desc = descriptor();
      const body = "x".repeat(1000);
      await q.stage(
        [1, 2, 3].map((n) =>
          stagedJob(desc, { eventId: `evt-${n}`, body, costBytes: 1000 }),
        ),
      );

      const batch = (await q.claim({
        maxJobs: 10,
        maxBytes: 2500,
        leaseMs: 30_000,
      })) as ClaimedBatch;
      const totalBytes = batch.jobs.reduce(
        (sum, job) => sum + job.header.costBytes,
        0,
      );
      expect(batch.jobs).toHaveLength(2);
      expect(totalBytes).toBeLessThanOrEqual(2500);
    });
  });

  describe("given a lane whose only job exceeds the configured byte bound", () => {
    /** @scenario A single job larger than the byte bound is still claimed alone */
    it("claims that job by itself", async () => {
      const q = queue();
      const desc = descriptor();
      const body = "x".repeat(5000);
      await q.stage([stagedJob(desc, { body, costBytes: 5000 })]);

      const batch = (await q.claim({
        maxJobs: 10,
        maxBytes: 100,
        leaseMs: 30_000,
      })) as ClaimedBatch;
      expect(batch.jobs).toHaveLength(1);
    });
  });

  describe("given a lane that has been parked with a reason", () => {
    /** @scenario A parked lane is never returned by a claim */
    it("is never returned by a claim", async () => {
      const q = queue();
      const desc = descriptor();
      await q.stage([stagedJob(desc)]);

      const first = (await q.claim({
        maxJobs: 10,
        maxBytes: 10_000_000,
        leaseMs: 30_000,
      })) as ClaimedBatch;
      await q.park(first.lease, "poisoned");

      const attempt = await claimSpecificLane(q, desc);
      expect(attempt).toBeNull();
    });
  });

  describe("given one lane that has been parked and a second lane with its own job", () => {
    /** @scenario Parking one lane does not stop another lane's work */
    it("still returns the second lane's job", async () => {
      const q = queue();
      const parkedLane = descriptor();
      const healthyLane = descriptor();

      // Staged and parked before the healthy lane exists at all, so claiming
      // it is deterministic — no need to pick it out of several eligible
      // candidates (claim() has no lane-targeting parameter, and no rotation
      // to rely on: it matches memory.ts's plain first-eligible scan).
      await q.stage([stagedJob(parkedLane)]);
      const claimedParkedLane = (await q.claim({
        maxJobs: 10,
        maxBytes: 10_000_000,
        leaseMs: 30_000,
      })) as ClaimedBatch;
      expect(claimedParkedLane).not.toBeNull();
      await q.park(claimedParkedLane.lease, "poisoned");

      // Now the only unparked lane in the registry.
      await q.stage([stagedJob(healthyLane)]);
      const healthy = await q.claim({
        maxJobs: 10,
        maxBytes: 10_000_000,
        leaseMs: 30_000,
      });
      expect(healthy).not.toBeNull();
      expect(healthy?.lease.groupKey).toBe(renderGroupKey(healthyLane));
    });
  });

  describe("given a tenant with two lanes and a soft cap of one", () => {
    /** @scenario A tenant already at its configured in-flight cap has its other lanes skipped */
    it("skips the tenant's second lane once the first is claimed", async () => {
      const q = queue({ tenantSoftCap: 1 });
      const tenantId = uniqueTenant();
      const laneA = descriptor({ tenantId });
      const laneB = descriptor({ tenantId });
      await q.stage([stagedJob(laneA), stagedJob(laneB)]);

      const first = await q.claim({
        maxJobs: 10,
        maxBytes: 10_000_000,
        leaseMs: 30_000,
      });
      expect(first).not.toBeNull();

      const second = await q.claim({
        maxJobs: 10,
        maxBytes: 10_000_000,
        leaseMs: 30_000,
      });
      expect(second).toBeNull();
    });
  });

  describe("given a tenant at its soft cap whose claimed lane is then settled", () => {
    /** @scenario A tenant back under its cap is claimable again without a separate reset */
    it("is claimable again once its claimed lane is settled", async () => {
      const q = queue({ tenantSoftCap: 1 });
      const tenantId = uniqueTenant();
      const laneA = descriptor({ tenantId });
      const laneB = descriptor({ tenantId });
      await q.stage([stagedJob(laneA), stagedJob(laneB)]);

      const first = (await q.claim({
        maxJobs: 10,
        maxBytes: 10_000_000,
        leaseMs: 30_000,
      })) as ClaimedBatch;
      expect(first).not.toBeNull();
      await q.settle(first.lease);

      const second = await q.claim({
        maxJobs: 10,
        maxBytes: 10_000_000,
        leaseMs: 30_000,
      });
      expect(second).not.toBeNull();
    });
  });

  describe("given a tenant with two lanes and no configured soft cap", () => {
    /** @scenario A soft cap of zero disables the tenant cap */
    it("does not skip either claim for being over a cap", async () => {
      const q = queue(); // tenantSoftCap defaults to 0 (disabled)
      const tenantId = uniqueTenant();
      const laneA = descriptor({ tenantId });
      const laneB = descriptor({ tenantId });
      await q.stage([stagedJob(laneA), stagedJob(laneB)]);

      const first = await q.claim({
        maxJobs: 10,
        maxBytes: 10_000_000,
        leaseMs: 30_000,
      });
      expect(first).not.toBeNull();
      const second = await q.claim({
        maxJobs: 10,
        maxBytes: 10_000_000,
        leaseMs: 30_000,
      });
      expect(second).not.toBeNull();
    });
  });

  describe("given a job that has been claimed and then settled", () => {
    /** @scenario A settled job is never claimed again */
    it("is not returned by a later claim on the same lane, because the lane is empty", async () => {
      const q = queue();
      const desc = descriptor();
      await q.stage([stagedJob(desc)]);

      const first = (await q.claim({
        maxJobs: 10,
        maxBytes: 10_000_000,
        leaseMs: 30_000,
      })) as ClaimedBatch;
      await q.settle(first.lease);

      const depth = await q.depth(first.lease.groupKey);
      expect(depth).toBe(0);
      const second = await claimSpecificLane(q, desc);
      expect(second).toBeNull();
    });
  });

  describe("given a lane queue that has already run its scripts once", () => {
    /** @scenario Staging still works after the server's script cache is flushed */
    it("stages successfully after the server's script cache is flushed", async () => {
      const q = queue();
      const desc = descriptor();
      await q.stage([stagedJob(desc, { eventId: "evt-before-flush" })]);

      await redis.script("FLUSH");

      await q.stage([stagedJob(desc, { eventId: "evt-after-flush" })]);
      const depth = await q.depth(renderGroupKey(desc));
      expect(depth).toBe(2);
    });
  });
});

/** Claims repeatedly (the registry may return other lanes first) until this
 * lane's own batch appears or every candidate has been tried once. A
 * non-matching claim is put straight back (retry with no delay), never
 * settled — settling would destroy a sibling lane's own job before the test
 * that staged it gets a chance to use it. */
async function claimSpecificLane(
  q: ReturnType<typeof redisLaneQueue>,
  desc: GroupKey,
  request = { maxJobs: 10, maxBytes: 10_000_000, leaseMs: 30_000 },
): Promise<ClaimedBatch | null> {
  const target = renderGroupKey(desc);
  const seen = new Set<string>();
  for (let i = 0; i < 25; i++) {
    const batch = await q.claim(request);
    if (batch === null) return null;
    if (batch.lease.groupKey === target) return batch;
    if (seen.has(batch.lease.groupKey)) {
      await q.retry(batch.lease, 0);
      return null; // cycled back to an already-seen lane without finding the target
    }
    seen.add(batch.lease.groupKey);
    await q.retry(batch.lease, 0);
  }
  return null;
}
