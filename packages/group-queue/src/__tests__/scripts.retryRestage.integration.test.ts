import IORedis, { type Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GroupStagingScripts } from "../scripts";

let redis: Redis;
let scripts: GroupStagingScripts;
const QUEUE_NAME = "{test/scripts-retry-restage}";

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

describe("GroupStagingScripts", () => {
  describe("when a retry re-stages a job", () => {
    // The group's retry chain and the re-stage are ONE script (ADR-080).
    // Since the staged id stopped carrying a `/r/<n>` marker, that chain is
    // the only attempt carrier a re-staged SIBLING has — it comes back with
    // its original envelope and no `__attempt`. A chain write that failed
    // while the re-stage succeeded would hand the next sibling-led claim a
    // fresh budget: an unbounded ladder, and a fold that re-applies events it
    // had already recorded as applied.
    const attemptKey = () => `${keyPrefix()}group:group-a:attempt`;

    /** @scenario A sibling-led claim after a retry still sees the attempt the ladder reached */
    it("records the attempt the ladder reached in the same step", async () => {
      await scripts.stage(makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }));
      await scripts.dispatch({ nowMs: 200, activeTtlSec: 300 });

      await scripts.retryRestage({
        groupId: "group-a",
        stagedJobId: "j1",
        newStagedJobId: "j1",
        dispatchAfterMs: 5_000,
        jobDataJson: JSON.stringify({ v: 1 }),
        backoffMs: 3_000,
        attempt: 4,
        attemptTtlSec: 1800,
      });

      // A sibling leading the next claim carries no attempt of its own, so
      // this key is the only thing standing between it and a fresh budget.
      expect(await redis.get(attemptKey())).toBe("4");
      expect(await redis.ttl(attemptKey())).toBeGreaterThan(0);
    });

    /** @scenario A retry that cannot record its attempt does not re-stage the job */
    it("advances neither the chain nor the staging set when it does not own the slot", async () => {
      await scripts.stage(makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }));
      await scripts.dispatch({ nowMs: 200, activeTtlSec: 300 });

      // Another worker owns the slot now: the guard fails and the script
      // writes nothing. Pre-ADR-080 the attempt was written by the CALLER
      // before this call, so it advanced even when the re-stage did not —
      // shortening the next job's budget for a job that was never staged.
      const restaged = await scripts.retryRestage({
        groupId: "group-a",
        stagedJobId: "someone-elses-job",
        newStagedJobId: "someone-elses-job",
        dispatchAfterMs: 5_000,
        jobDataJson: JSON.stringify({ v: 1 }),
        backoffMs: 3_000,
        attempt: 9,
        attemptTtlSec: 1800,
      });

      expect(restaged).toBe(false);
      expect(await redis.get(attemptKey())).toBeNull();
    });
  });
});
