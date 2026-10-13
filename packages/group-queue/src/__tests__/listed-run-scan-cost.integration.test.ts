/**
 * A claim over a listed run looks at each candidate once and passes running groups by.
 * Spec: specs/listed-run-scan-cost.feature.
 */
import IORedis, { type Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GroupStagingScripts } from "../scripts.ts";

let redis: Redis;
let scripts: GroupStagingScripts;
const QUEUE_NAME = "{test/gq-listed-scan-cost}";
const LIST_KEY = `${QUEUE_NAME}:gq:listed:run`;
const CANDIDATES_KEY = `${LIST_KEY}:candidates`;

async function stage({ groupId, jobId, dueMs }: { groupId: string; jobId: string; dueMs: number }) {
  await scripts.stage({
    stagedJobId: jobId,
    groupId,
    dispatchAfterMs: dueMs,
    dedupId: "",
    dedupTtlMs: 0,
    jobDataJson: JSON.stringify({ jobId }),
  });
}

function claim({ nowMs, maxJobs }: { nowMs: number; maxJobs: number }) {
  return scripts.dispatchBatch({
    nowMs,
    activeTtlSec: 300,
    maxJobs,
    allowedGroupsKey: CANDIDATES_KEY,
    listKey: LIST_KEY,
  });
}

/** ZSCORE calls Redis ran, scripts' own included: one per candidate a claim looks at. */
async function zscoreCalls(): Promise<number> {
  const stats = await redis.info("commandstats");
  return Number(/cmdstat_zscore:calls=(\d+)/.exec(stats)?.[1] ?? 0);
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

describe("given a listed run's candidates", () => {
  /** @scenario "A claim passes over a group already running until its job completes" */
  it("passes a running group by until its completion brings it back with more work", async () => {
    const nowMs = Date.now();
    await stage({ groupId: "tenant/g1", jobId: "j1", dueMs: nowMs - 1_000 });
    await scripts.registerPreflightTargets({ targetKey: LIST_KEY, groupIds: ["tenant/g1"] });

    const [first] = await claim({ nowMs, maxJobs: 10 });
    expect(first?.stagedJobId).toBe("j1");
    await stage({ groupId: "tenant/g1", jobId: "j2", dueMs: nowMs - 500 });
    const runningScore = await redis.zscore(CANDIDATES_KEY, "tenant/g1");
    expect(Number(runningScore)).toBeGreaterThan(nowMs);

    expect(await claim({ nowMs: nowMs + 10, maxJobs: 10 })).toEqual([]);
    expect(await redis.zscore(CANDIDATES_KEY, "tenant/g1")).toBe(runningScore);

    const completed = await scripts.complete({
      groupId: "tenant/g1",
      stagedJobId: "j1",
      claimToken: first!.claimToken,
      candidatesKey: CANDIDATES_KEY,
    });
    expect(completed).toBe(true);
    expect(Number(await redis.zscore(CANDIDATES_KEY, "tenant/g1"))).toBe(nowMs - 500);

    const [second] = await claim({ nowMs: nowMs + 20, maxJobs: 10 });
    expect(second?.stagedJobId).toBe("j2");
  });

  /** @scenario "A claim with fewer due groups than free slots looks at each waiting group once" */
  it("looks at each of a hundred waiting groups once in one claim", async () => {
    const nowMs = Date.now();
    const groupIds = Array.from({ length: 100 }, (_, index) => `tenant${index}/g`);
    for (const groupId of groupIds) {
      await stage({ groupId, jobId: `${groupId}:j`, dueMs: nowMs + 3_600_000 });
    }
    await scripts.registerPreflightTargets({ targetKey: LIST_KEY, groupIds });

    const before = await zscoreCalls();
    expect(await claim({ nowMs, maxJobs: 1 })).toEqual([]);
    const looks = (await zscoreCalls()) - before;

    // One look per group; the scan budget for one free slot is 1,500 looks. The margin is
    // for another client of a shared test Redis, never for this claim.
    expect(looks).toBeGreaterThanOrEqual(groupIds.length);
    expect(looks).toBeLessThan(500);
  });
});
