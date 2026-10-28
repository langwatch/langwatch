/** A worker passes over the group it handed back; specs/hand-back-unhandled-job.feature. */

import IORedis, { type Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GroupStagingScripts } from "../scripts.ts";

const QUEUE_NAME = "{test/gq-hand-back-pass-over}";
const KEY_PREFIX = `${QUEUE_NAME}:gq:`;
const OLDER = "worker-older";
const NEWER = "worker-newer";
/** Long enough that it cannot lapse mid-test; the lapse scenario sets its own. */
const PASS_OVER_MS = 60_000;

let redis: Redis;
let scripts: GroupStagingScripts;

const handedBackKey = (groupId: string) => `${KEY_PREFIX}group:${groupId}:handed-back-by`;

async function deleteSuiteKeys(): Promise<void> {
  const keys = await redis.keys(`${QUEUE_NAME}*`);
  if (keys.length > 0) await redis.del(...keys);
}

async function stage({
  groupId,
  stagedJobId,
  dispatchAfterMs = 100,
}: {
  groupId: string;
  stagedJobId: string;
  dispatchAfterMs?: number;
}) {
  await scripts.stage({
    stagedJobId,
    groupId,
    dispatchAfterMs,
    dedupId: "",
    dedupTtlMs: 0,
    jobDataJson: JSON.stringify({ stagedJobId }),
    shouldExtend: true,
    shouldReplace: true,
  });
}

async function claimAs({ workerId, nowMs }: { workerId: string; nowMs: number }) {
  return scripts.dispatchBatch({ nowMs, activeTtlSec: 300, maxJobs: 10, workerId });
}

/** Claims group-a's job as `workerId` and hands it back, or re-stages it as a `retry`. */
async function claimAndReturn({
  workerId,
  passOver = { workerId, ttlMs: PASS_OVER_MS },
  retry = false,
}: {
  workerId: string;
  passOver?: { workerId: string; ttlMs: number };
  retry?: boolean;
}) {
  const [claim] = await claimAs({ workerId, nowMs: 200 });
  expect(claim?.groupId).toBe("group-a");
  const restaged = await scripts.retryRestage({
    groupId: "group-a",
    stagedJobId: claim!.stagedJobId,
    newStagedJobId: claim!.stagedJobId,
    dispatchAfterMs: 1_200,
    jobDataJson: claim!.jobDataJson,
    backoffMs: 1_000,
    attempt: 1,
    attemptTtlSec: 1_800,
    claimToken: claim!.claimToken,
    ...(retry ? {} : { passOver }),
  });
  expect(restaged).toBe(true);
  // The re-stage holds the group for its backoff; the scenarios start once that hold has lapsed.
  await redis.del(`${KEY_PREFIX}group:group-a:active`);
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

describe("given a worker that handed back the job of one group while another group has a job ready", () => {
  describe("when that worker claims", () => {
    /** @scenario "The worker that handed a job back passes over that group only" */
    it("claims the other group's job and leaves the handed-back job ready", async () => {
      await stage({ groupId: "group-a", stagedJobId: "job-a" });
      await claimAndReturn({ workerId: OLDER });
      await stage({ groupId: "group-b", stagedJobId: "job-b" });

      const claims = await claimAs({ workerId: OLDER, nowMs: 2_000 });

      expect(claims.map((claim) => claim.groupId)).toEqual(["group-b"]);
      expect(await redis.zscore(`${KEY_PREFIX}ready`, "group-a")).not.toBeNull();
      expect(await redis.zrange(`${KEY_PREFIX}group:group-a:jobs`, 0, -1)).toEqual(["job-a"]);
      expect(await redis.get(handedBackKey("group-a"))).toBe(OLDER);
    });
  });
});

describe("given a job one worker handed back", () => {
  describe("when another worker claims it and completes it", () => {
    /** @scenario "Another worker's claim clears the hand-back record" */
    it("clears the record, so the worker that handed it back claims the group's next job", async () => {
      await stage({ groupId: "group-a", stagedJobId: "job-1" });
      await claimAndReturn({ workerId: OLDER });
      await stage({ groupId: "group-a", stagedJobId: "job-2", dispatchAfterMs: 1_500 });

      const [claim] = await claimAs({ workerId: NEWER, nowMs: 2_000 });
      expect(claim?.stagedJobId).toBe("job-1");
      expect(await redis.exists(handedBackKey("group-a"))).toBe(0);
      await scripts.complete({
        groupId: "group-a",
        stagedJobId: "job-1",
        claimToken: claim!.claimToken,
      });

      expect(await redis.exists(handedBackKey("group-a"))).toBe(0);
      const next = await claimAs({ workerId: OLDER, nowMs: 3_000 });
      expect(next.map((each) => each.stagedJobId)).toEqual(["job-2"]);
    });
  });
});

describe("given a job re-staged by a retry, not a hand-back", () => {
  describe("when the worker that retried it claims after the backoff", () => {
    /** @scenario "An ordinary retry is not passed over" */
    it("claims the job again", async () => {
      await stage({ groupId: "group-a", stagedJobId: "job-a" });
      await claimAndReturn({ workerId: OLDER, retry: true });

      expect(await redis.exists(handedBackKey("group-a"))).toBe(0);
      const claims = await claimAs({ workerId: OLDER, nowMs: 2_000 });
      expect(claims.map((claim) => claim.stagedJobId)).toEqual(["job-a"]);
    });
  });
});

describe("given a job one worker handed back, and the peer that could run it died before claiming it", () => {
  /** @scenario "A worker whose peer died takes back a job it handed back once the record lapses" */
  it("claims nothing from that group until the record lapses, then claims it on the same attempt", async () => {
    const ttlMs = 300;
    await stage({ groupId: "group-a", stagedJobId: "job-a" });
    await claimAndReturn({ workerId: OLDER, passOver: { workerId: OLDER, ttlMs } });

    expect(await claimAs({ workerId: OLDER, nowMs: 2_000 })).toEqual([]);

    await new Promise((resolve) => setTimeout(resolve, ttlMs + 100));
    const claims = await claimAs({ workerId: OLDER, nowMs: 3_000 });
    expect(claims.map((claim) => [claim.stagedJobId, claim.groupAttempt])).toEqual([["job-a", 1]]);
  });
});
