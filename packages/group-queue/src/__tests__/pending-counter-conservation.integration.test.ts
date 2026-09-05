import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GroupQueueProcessor } from "../groupQueue";
import { GroupStagingScripts } from "../scripts";

/**
 * The total-pending counter must stay consistent across every lifecycle path.
 * Post-2026-05-21 Redis saturation incident: an active key that expired before
 * COMPLETE used to leave the counter high for ever (826K phantom pending in
 * production), because the DECR lived in COMPLETE rather than in DISPATCH.
 */
let redis: Redis;
let scripts: GroupStagingScripts;
const QUEUE_NAME = "{test/pending-counter}";

function keyPrefix() {
  return `${QUEUE_NAME}:gq:`;
}

function makeJob(overrides: Partial<Parameters<typeof scripts.stage>[0]> = {}) {
  return {
    stagedJobId: `job-${crypto.randomUUID().slice(0, 8)}`,
    groupId: "group-a",
    dispatchAfterMs: 1000,
    dedupId: "",
    dedupTtlMs: 0,
    jobDataJson: JSON.stringify({ hello: "world" }),
    shouldExtend: true,
    shouldReplace: true,
    ...overrides,
  };
}

async function inspectTotalPending(): Promise<number> {
  const value = await redis.get(`${keyPrefix()}stats:total-pending`);
  return Number(value) || 0;
}

async function deleteSuiteKeys(): Promise<void> {
  const keys = await redis.keys(`${QUEUE_NAME}*`);
  if (keys.length > 0) await redis.del(...keys);
}

beforeAll(() => {
  redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: 0,
  });
});

beforeEach(async () => {
  await deleteSuiteKeys();
  scripts = new GroupStagingScripts(redis, QUEUE_NAME);
});

afterAll(async () => {
  await deleteSuiteKeys();
  await redis.quit();
});

describe("GroupStagingScripts — pending counter conservation", () => {
  describe("when the happy path completes normally", () => {
    /** @scenario Counter tracks jobs in :jobs ZSETs through happy path */
    it("returns total-pending to 0 after stage, dispatch and complete", async () => {
      await scripts.stage(makeJob({ stagedJobId: "j1", groupId: "g1", dispatchAfterMs: 100 }));
      await scripts.stage(makeJob({ stagedJobId: "j2", groupId: "g2", dispatchAfterMs: 100 }));
      await scripts.stage(makeJob({ stagedJobId: "j3", groupId: "g3", dispatchAfterMs: 100 }));

      expect(await inspectTotalPending()).toBe(3);

      const d1 = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
      const d2 = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
      const d3 = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });

      for (const dispatched of [d1, d2, d3]) {
        await scripts.complete({
          groupId: dispatched!.groupId,
          stagedJobId: dispatched!.stagedJobId,
        });
      }

      expect(await inspectTotalPending()).toBe(0);
    });
  });

  describe("when the active key expires before COMPLETE", () => {
    /** @scenario Counter stays accurate when activeKey expires before COMPLETE */
    it("keeps the counter at zero because the decrement happened at dispatch", async () => {
      await scripts.stage(makeJob({ stagedJobId: "j1", groupId: "g-leak", dispatchAfterMs: 100 }));
      expect(await inspectTotalPending()).toBe(1);

      await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
      // The DECR happened at dispatch time (ZREM from :jobs).
      expect(await inspectTotalPending()).toBe(0);

      // Redis TTL fires, or saturation delays the heartbeat.
      await redis.del(`${keyPrefix()}group:g-leak:active`);

      const completed = await scripts.complete({ groupId: "g-leak", stagedJobId: "j1" });
      expect(completed).toBe(false);

      // COMPLETE no longer touches the counter, so active-key expiry cannot
      // cause drift. This was the root cause of the phantom counter in
      // production.
      expect(await inspectTotalPending()).toBe(0);
    });
  });

  describe("when the same staged-job id is staged twice", () => {
    /** @scenario Counter is conserved when the same staged-job id is re-sent */
    it("counts the job once in total-pending", async () => {
      await scripts.stage(
        makeJob({ stagedJobId: "j-dup", groupId: "g-dup", dispatchAfterMs: 100 }),
      );
      // Re-delivery of the same event id: the ZADD updates the member in place,
      // so the counter must not INCR a second time.
      await scripts.stage(
        makeJob({ stagedJobId: "j-dup", groupId: "g-dup", dispatchAfterMs: 150 }),
      );

      expect(await redis.zcard(`${keyPrefix()}group:g-dup:jobs`)).toBe(1);
      expect(await inspectTotalPending()).toBe(1);
    });

    it("counts the job once when the duplicate arrives inside one stageBatch call", async () => {
      const job = makeJob({
        stagedJobId: "j-dup-batch",
        groupId: "g-dup-batch",
        dispatchAfterMs: 100,
      });
      const { newStagedCount } = await scripts.stageBatch([job, { ...job, dispatchAfterMs: 150 }]);

      expect(newStagedCount).toBe(1);
      expect(await redis.zcard(`${keyPrefix()}group:g-dup-batch:jobs`)).toBe(1);
      expect(await inspectTotalPending()).toBe(1);
    });
  });

  describe("when a job is retried via retryRestage", () => {
    /** @scenario Counter tracks retry restage as a new pending job */
    it("returns total-pending to 0 after the retry finally completes", async () => {
      await scripts.stage(makeJob({ stagedJobId: "j1", groupId: "g-retry", dispatchAfterMs: 100 }));
      expect(await inspectTotalPending()).toBe(1);

      const d1 = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
      expect(d1).not.toBeNull();

      const restaged = await scripts.retryRestage({
        groupId: "g-retry",
        stagedJobId: "j1",
        newStagedJobId: "j1/r/1",
        dispatchAfterMs: 300,
        jobDataJson: JSON.stringify({ attempt: 2 }),
        backoffMs: 1000,
        attempt: 1,
        attemptTtlSec: 1800,
      });
      expect(restaged).toBe(true);

      // The active key expires after the short backoff TTL.
      await redis.del(`${keyPrefix()}group:g-retry:active`);

      const d2 = await scripts.dispatch({ nowMs: 400, activeTtlSec: 60 });
      expect(d2?.stagedJobId).toBe("j1/r/1");

      await scripts.complete({ groupId: "g-retry", stagedJobId: "j1/r/1" });

      expect(await inspectTotalPending()).toBe(0);
    });
  });

  describe("when a job exhausts retries via restageAndBlock", () => {
    /** @scenario Counter tracks restage-and-block as a new pending job */
    it("returns total-pending to 0 after the group is unblocked and the job completes", async () => {
      await scripts.stage(makeJob({ stagedJobId: "j1", groupId: "g-block", dispatchAfterMs: 100 }));
      expect(await inspectTotalPending()).toBe(1);

      const d1 = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
      expect(d1).not.toBeNull();

      await scripts.restageAndBlock({
        groupId: "g-block",
        newStagedJobId: "j1/r/final",
        score: 100,
        jobDataJson: JSON.stringify({ exhausted: true }),
        errorMessage: "Max retries exceeded",
      });

      expect(await inspectTotalPending()).toBe(1);

      // The operator's "try again". The unblock script itself lives with the
      // ops queue repository, which depends on this package — so the three
      // writes it makes to this suite's own keys stand in for it here.
      expect(await redis.srem(`${keyPrefix()}blocked`, "g-block")).toBe(1);
      await redis.del(`${keyPrefix()}group:g-block:active`);
      await redis.zadd(`${keyPrefix()}ready`, 1, "g-block");

      const d2 = await scripts.dispatch({ nowMs: 300, activeTtlSec: 60 });
      expect(d2?.stagedJobId).toBe("j1/r/final");

      await scripts.complete({ groupId: "g-block", stagedJobId: "j1/r/final" });

      expect(await inspectTotalPending()).toBe(0);
    });
  });

  describe("when groups are left in mixed staged and in-flight states", () => {
    /** @scenario Counter equals sum of all :jobs ZSET cardinalities */
    it("keeps total-pending equal to the sum of ZCARD across every group", async () => {
      const staged: [string, string][] = [
        ["a1", "g-recon-a"],
        ["a2", "g-recon-a"],
        ["b1", "g-recon-b"],
        ["c1", "g-recon-c"],
        ["c2", "g-recon-c"],
      ];
      for (const [stagedJobId, groupId] of staged) {
        await scripts.stage(makeJob({ stagedJobId, groupId, dispatchAfterMs: 100 }));
      }

      // Dispatch some, creating mixed state. Active jobs were already DECRed
      // at dispatch time, so the counter must count only the :jobs zsets.
      await scripts.dispatch({ nowMs: 300, activeTtlSec: 60 });
      await scripts.dispatch({ nowMs: 300, activeTtlSec: 60 });

      let actualPending = 0;
      for (const groupId of ["g-recon-a", "g-recon-b", "g-recon-c"]) {
        actualPending += await redis.zcard(`${keyPrefix()}group:${groupId}:jobs`);
      }

      expect(await inspectTotalPending()).toBe(actualPending);
    });
  });

  describe("when siblings are drained for coalescing", () => {
    /** @scenario Draining siblings for coalescing decrements pending per job */
    it("decrements total-pending by the number drained", async () => {
      await scripts.stage(makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }));
      await scripts.stage(makeJob({ stagedJobId: "j2", dispatchAfterMs: 200 }));
      await scripts.stage(makeJob({ stagedJobId: "j3", dispatchAfterMs: 300 }));
      expect(await inspectTotalPending()).toBe(3);

      await scripts.drainGroupReady({ groupId: "group-a", nowMs: 10_000, maxJobs: 2 });

      expect(await inspectTotalPending()).toBe(1);
    });
  });
});

describe("GroupQueueProcessor — pending index", () => {
  let indexRedis: Redis;
  const queues: GroupQueueProcessor<{ id: string; groupId: string; value: string }>[] = [];

  beforeAll(() => {
    indexRedis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 0,
    });
  });

  afterEach(async () => {
    await Promise.all(queues.splice(0).map((q) => q.close().catch(() => {})));
    const keys = await indexRedis.keys("{test/pending-index/*");
    if (keys.length > 0) await indexRedis.del(...keys);
  });

  afterAll(async () => {
    await indexRedis.quit();
  });

  describe("when jobs are staged faster than they are processed", () => {
    /** @scenario Staging a job records its group as holding pending work */
    it("records the group in the pending index", async () => {
      // The ops reconcile counts jobs by asking this index which groups to look
      // at, and it is written by the staging script itself. Held here by a
      // processor that never finishes the first job, so the siblings stay
      // staged for the assertion.
      let releaseFirst: (() => void) | undefined;
      const firstJobHeld = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const queueName = `{test/pending-index/${crypto.randomUUID().slice(0, 8)}}`;
      const queue = new GroupQueueProcessor<{ id: string; groupId: string; value: string }>(
        {
          name: queueName,
          groupKey: (p) => p.groupId,
          identify: (p) => p.id,
          process: async () => {
            await firstJobHeld;
          },
        },
        indexRedis,
      );
      queues.push(queue);
      await queue.waitUntilReady();

      for (const id of ["p1", "p2", "p3"]) {
        await queue.send({ id, groupId: "pending-group", value: id });
      }

      try {
        await vi.waitFor(
          async () => {
            expect(
              await indexRedis.sismember(`${queueName}:gq:pending-groups`, "pending-group"),
            ).toBe(1);
          },
          { timeout: 5000, interval: 50 },
        );
      } finally {
        // Unblock the processor even when the assertion fails, so teardown
        // closes a queue that is idle rather than waiting out its shutdown
        // timeout and charging the delay to whichever test runs next.
        releaseFirst?.();
      }
    });
  });
});
