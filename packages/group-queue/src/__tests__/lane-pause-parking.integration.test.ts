/**
 * A paused lane's groups are held OUT of the dispatch scan, as a paused
 * tenant's are, and come back at their scores once the pause entry is gone.
 * @see specs/queue-pausing/queue-pausing.feature
 */
import IORedis, { type Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_TENANT_CAP, GroupStagingScripts } from "../scripts.ts";

const QUEUE_NAME = "{test/lane-pause-parking}";
const PAUSE_KEY = "trace_processing/projection/traceSummary";
/** The dispatch scan examines at most this many groups per call with the default cap. */
const SCAN_BUDGET = 30 * DEFAULT_TENANT_CAP;

let redis: Redis;
let scripts: GroupStagingScripts;

const keyPrefix = () => `${QUEUE_NAME}:gq:`;
const readyKey = () => `${keyPrefix()}ready`;
const laneParkedKey = () => `${keyPrefix()}parked-lane:${PAUSE_KEY}`;

function routed({ pipeline, jobType, name }: { pipeline: string; jobType: string; name: string }) {
  const header = JSON.stringify({ p: pipeline, t: jobType, n: name });
  return `GQ2|${Buffer.byteLength(header)}|${header}`;
}

const pausedLaneJob = routed({
  pipeline: "trace_processing",
  jobType: "projection",
  name: "traceSummary",
});
const runnableJob = routed({
  pipeline: "trace_processing",
  jobType: "command",
  name: "recordSpan",
});

function stage({
  groupId,
  stagedJobId,
  dispatchAfterMs,
  jobDataJson,
}: {
  groupId: string;
  stagedJobId: string;
  dispatchAfterMs: number;
  jobDataJson: string;
}) {
  return scripts.stage({
    stagedJobId,
    groupId,
    dispatchAfterMs,
    dedupId: "",
    dedupTtlMs: 0,
    jobDataJson,
    shouldExtend: true,
    shouldReplace: true,
  });
}

async function stagePausedLaneGroups({ count }: { count: number }): Promise<void> {
  for (let start = 0; start < count; start += 200) {
    const chunk = Array.from({ length: Math.min(200, count - start) }, (_, k) => start + k);
    await Promise.all(
      chunk.map((i) =>
        stage({
          groupId: `project_A/fold/traceSummary/trace:${i}`,
          stagedJobId: `paused-${i}`,
          dispatchAfterMs: 100 + i,
          jobDataJson: pausedLaneJob,
        }),
      ),
    );
  }
}

async function deleteSuiteKeys(): Promise<void> {
  const keys = await redis.keys(`${QUEUE_NAME}*`);
  if (keys.length > 0) await redis.del(...keys);
}

beforeAll(() => {
  redis = new IORedis(
    process.env.LANGWATCH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? "redis://localhost:6379",
    { maxRetriesPerRequest: 0 },
  );
});

beforeEach(async () => {
  await deleteSuiteKeys();
  scripts = new GroupStagingScripts(redis, QUEUE_NAME);
});

afterAll(async () => {
  await deleteSuiteKeys();
  await redis.quit();
});

describe("given more paused-lane groups than the scan budget ahead of a runnable group", () => {
  const pausedCount = SCAN_BUDGET + 100;

  beforeEach(async () => {
    await stagePausedLaneGroups({ count: pausedCount });
    await stage({
      groupId: "project_B/command/recordSpan/trace:b",
      stagedJobId: "runnable",
      dispatchAfterMs: 100 + pausedCount + 10,
      jobDataJson: runnableJob,
    });
    await scripts.addPauseKey(PAUSE_KEY);
  });

  describe("when the dispatcher runs", () => {
    /** @scenario A paused lane's backlog does not block other work */
    it("parks the paused groups out of ready and reaches the runnable group", async () => {
      const first = await scripts.dispatch({ nowMs: 10_000, activeTtlSec: 60 });
      // One call examines at most the budget: it parks those instead of re-reading them.
      expect(first).toBeNull();
      expect(await redis.zcard(laneParkedKey())).toBe(SCAN_BUDGET);

      const second = await scripts.dispatch({ nowMs: 10_000, activeTtlSec: 60 });

      expect(second?.groupId).toBe("project_B/command/recordSpan/trace:b");
      expect(await redis.zcard(laneParkedKey())).toBe(pausedCount);
      const ready = await redis.zrange(readyKey(), 0, -1);
      expect(ready.some((groupId) => groupId.startsWith("project_A/"))).toBe(false);
    });
  });

  describe("when the lane is unpaused", () => {
    /** @scenario Unpausing a lane restores its parked groups at their scores */
    it("puts every parked group back in ready with its original score", async () => {
      await scripts.dispatch({ nowMs: 10_000, activeTtlSec: 60 });
      await scripts.dispatch({ nowMs: 10_000, activeTtlSec: 60 });
      expect(await redis.zcard(laneParkedKey())).toBe(pausedCount);

      await scripts.removePauseKey(PAUSE_KEY);
      // Before every score, so the restoring calls dispatch nothing.
      await scripts.dispatch({ nowMs: 50, activeTtlSec: 60 });
      await scripts.dispatch({ nowMs: 50, activeTtlSec: 60 });

      expect(await redis.exists(laneParkedKey())).toBe(0);
      expect(await redis.sismember(`${keyPrefix()}parked-lanes`, PAUSE_KEY)).toBe(0);
      const scores = await redis.zmscore(
        readyKey(),
        ...Array.from({ length: pausedCount }, (_, i) => `project_A/fold/traceSummary/trace:${i}`),
      );
      expect(scores.map(Number)).toEqual(Array.from({ length: pausedCount }, (_, i) => 100 + i));
    });
  });

  describe("when the dispatcher runs again while the lane is still paused", () => {
    /** @scenario A still-paused lane is not restored */
    it("leaves the groups parked", async () => {
      await scripts.dispatch({ nowMs: 10_000, activeTtlSec: 60 });
      await scripts.dispatch({ nowMs: 10_000, activeTtlSec: 60 });
      // Past the reconcile gate as well.
      await scripts.dispatch({ nowMs: 20_000, activeTtlSec: 60 });

      expect(await redis.zcard(laneParkedKey())).toBe(pausedCount);
    });
  });
});
