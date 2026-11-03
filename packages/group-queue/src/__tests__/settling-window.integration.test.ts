import { nowInstant } from "@langwatch/time";
import IORedis, { type Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GroupStagingScripts, type StageSettling } from "../scripts.ts";

/**
 * The settling window, driven through the real staging and dispatch scripts on real Redis.
 * Windows are a minute wide so a slow run cannot end one by accident.
 * specs/settling-window.feature
 */
let redis: Redis;
const QUEUE_NAME = "{test/settling-window}";
const GROUP_ID = "group-a";
const MINUTE_MS = 60_000;

function scripts() {
  return new GroupStagingScripts(redis, QUEUE_NAME);
}

async function stageJob({
  index,
  dispatchAfterMs,
  settle,
}: {
  index: number;
  dispatchAfterMs: number;
  settle?: StageSettling;
}) {
  await scripts().stage({
    stagedJobId: `job-${index}`,
    groupId: GROUP_ID,
    dispatchAfterMs,
    dedupId: "",
    dedupTtlMs: 0,
    jobDataJson: JSON.stringify({ index }),
    settle,
  });
}

function claimAt(nowMs: number) {
  return scripts().dispatchBatch({ nowMs, activeTtlSec: 300, maxJobs: 10 });
}

async function readyScore(): Promise<number | null> {
  const score = await redis.zscore(`${QUEUE_NAME}:gq:ready`, GROUP_ID);
  return score === null ? null : Number(score);
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
});

afterAll(async () => {
  await deleteSuiteKeys();
  await redis.quit();
});

describe("GroupStagingScripts settling window", () => {
  describe("given a settling window of a minute and a batch of up to 10 jobs", () => {
    describe("when three jobs are sent to one group within the window", () => {
      /** @scenario "Jobs staged within the window are claimed together" */
      it("holds the group until the window ends, then claims all three together", async () => {
        const settle = { windowMs: MINUTE_MS, maxBatch: 10 };
        const occurredAtMs = nowInstant().epochMilliseconds - 1_000;
        for (const index of [0, 1, 2]) {
          await stageJob({ index, dispatchAfterMs: occurredAtMs + index, settle });
        }

        expect(await claimAt(nowInstant().epochMilliseconds)).toEqual([]);

        const afterWindowMs = nowInstant().epochMilliseconds + MINUTE_MS + 1;
        const claimed = await claimAt(afterWindowMs);
        expect(claimed.map((job) => job.stagedJobId)).toEqual(["job-0"]);

        const drained = await scripts().drainGroupReady({
          groupId: GROUP_ID,
          nowMs: afterWindowMs,
          maxJobs: 9,
        });
        expect(drained.map((job) => job.stagedJobId)).toEqual(["job-1", "job-2"]);
      });
    });
  });

  describe("given a settling window of a minute and a batch of up to 3 jobs", () => {
    describe("when the group fills its batch", () => {
      /** @scenario "A group holding a full batch is claimable at once" */
      it("is not claimable at two jobs and claimable at once at three", async () => {
        const settle = { windowMs: MINUTE_MS, maxBatch: 3 };
        const occurredAtMs = nowInstant().epochMilliseconds - 1_000;
        await stageJob({ index: 0, dispatchAfterMs: occurredAtMs, settle });
        await stageJob({ index: 1, dispatchAfterMs: occurredAtMs + 1, settle });

        expect(await claimAt(nowInstant().epochMilliseconds)).toEqual([]);

        await stageJob({ index: 2, dispatchAfterMs: occurredAtMs + 2, settle });

        expect(await readyScore()).toBe(occurredAtMs);
        const claimed = await claimAt(nowInstant().epochMilliseconds);
        expect(claimed.map((job) => job.stagedJobId)).toEqual(["job-0"]);
      });
    });
  });

  describe("given a settling window of 0", () => {
    describe("when a job is sent to a group", () => {
      /** @scenario "A window of 0 claims a group as soon as its job is due" */
      it("scores the group at the job's own score and claims it at once", async () => {
        const occurredAtMs = nowInstant().epochMilliseconds - 1_000;
        await stageJob({
          index: 0,
          dispatchAfterMs: occurredAtMs,
          settle: { windowMs: 0, maxBatch: 10 },
        });

        expect(await readyScore()).toBe(occurredAtMs);
        const claimed = await claimAt(nowInstant().epochMilliseconds);
        expect(claimed.map((job) => job.stagedJobId)).toEqual(["job-0"]);
      });
    });
  });

  describe("given a group whose job is already due and waiting for a slot", () => {
    describe("when another job is sent to it with a settling window of a minute", () => {
      /** @scenario "A job sent to a group already waiting never delays it" */
      it("keeps the earlier score, so the group is still claimable at once", async () => {
        const occurredAtMs = nowInstant().epochMilliseconds - 1_000;
        await stageJob({ index: 0, dispatchAfterMs: occurredAtMs });
        await stageJob({
          index: 1,
          dispatchAfterMs: occurredAtMs + 1,
          settle: { windowMs: MINUTE_MS, maxBatch: 10 },
        });

        expect(await readyScore()).toBe(occurredAtMs);
        const claimed = await claimAt(nowInstant().epochMilliseconds);
        expect(claimed.map((job) => job.stagedJobId)).toEqual(["job-0"]);
      });
    });
  });

  describe("given jobs staged in one batch call within the window", () => {
    describe("when the window has not ended", () => {
      /** @scenario "Jobs staged in one batch call settle like single sends" */
      it("holds the group like single sends do", async () => {
        const occurredAtMs = nowInstant().epochMilliseconds - 1_000;
        const settle = { windowMs: MINUTE_MS, maxBatch: 10 };
        await scripts().stageBatch(
          [0, 1].map((index) => ({
            stagedJobId: `job-${index}`,
            groupId: GROUP_ID,
            dispatchAfterMs: occurredAtMs + index,
            dedupId: "",
            dedupTtlMs: 0,
            jobDataJson: JSON.stringify({ index }),
            settle,
          })),
        );

        expect(await claimAt(nowInstant().epochMilliseconds)).toEqual([]);
        const claimed = await claimAt(nowInstant().epochMilliseconds + MINUTE_MS + 1);
        expect(claimed.map((job) => job.stagedJobId)).toEqual(["job-0"]);
      });
    });
  });
});
