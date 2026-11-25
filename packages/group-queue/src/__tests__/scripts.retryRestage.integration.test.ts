import IORedis, { type Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GroupStagingScripts } from "../scripts.ts";

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

  describe("when a retry ladder ends in a block and jobs keep arriving one at a time", () => {
    const jobsKey = () => `${keyPrefix()}group:group-a:jobs`;
    const dataKey = () => `${keyPrefix()}group:group-a:data`;

    /** @scenario "Jobs staged one at a time into a blocked group carry no expiry" */
    it("keeps the group's jobs and values persistent through a dedup replacement and a re-send", async () => {
      const value = JSON.stringify({ v: 1 });
      await scripts.stage(makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }));
      const first = await scripts.dispatch({ nowMs: 200, activeTtlSec: 300 });
      await scripts.retryRestage({
        groupId: "group-a",
        stagedJobId: "j1",
        newStagedJobId: "j1",
        dispatchAfterMs: 300,
        jobDataJson: value,
        backoffMs: 1_000,
        attempt: 2,
        attemptTtlSec: 1800,
        claimToken: first!.claimToken,
      });
      expect(await redis.pttl(jobsKey())).toBeGreaterThan(0);

      // The backoff's active key lapses and the last attempt blocks the group.
      await redis.del(`${keyPrefix()}group:group-a:active`);
      const last = await scripts.dispatch({ nowMs: 400, activeTtlSec: 300 });
      expect(last?.stagedJobId).toBe("j1");
      expect(
        await scripts.restageAndBlock({
          groupId: "group-a",
          newStagedJobId: "j1",
          score: 100,
          jobDataJson: value,
          errorMessage: "retry budget spent",
          claimToken: last!.claimToken,
        }),
      ).toBe(true);
      expect(await redis.pttl(jobsKey())).toBe(-1);

      const dedup = { dedupId: "d1", dedupTtlMs: 60_000 };
      await scripts.stage(makeJob({ stagedJobId: "j2", dispatchAfterMs: 500 }));
      await scripts.stage(makeJob({ stagedJobId: "j3", dispatchAfterMs: 600, ...dedup }));
      const replaced = await scripts.stage(
        makeJob({ stagedJobId: "j4", dispatchAfterMs: 700, jobDataJson: "replacement", ...dedup }),
      );
      await scripts.stage(makeJob({ stagedJobId: "j2", dispatchAfterMs: 500 }));

      expect(replaced.isNew).toBe(false);
      expect(await redis.zrange(jobsKey(), 0, -1)).toEqual(["j1", "j2", "j3"]);
      expect(await redis.hget(dataKey(), "j3")).toBe("replacement");
      expect(await redis.pttl(jobsKey())).toBe(-1);
      expect(await redis.pttl(dataKey())).toBe(-1);
    });
  });
});
