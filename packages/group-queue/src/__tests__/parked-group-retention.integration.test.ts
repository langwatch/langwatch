/**
 * A parked group is live work held back by its tenant's cap or a paused lane, possibly
 * for hours: neither the reaper nor the group-key TTL may take its jobs while it waits.
 * @see specs/parked-group-retention.feature
 */
import IORedis, { type Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { deleteStrandedGroup, GroupStagingScripts } from "../scripts.ts";
import { reapStrandedGroups } from "../tasks/reap-stranded-groups.task.ts";

const QUEUE_NAME = "{test/parked-group-retention}";
const PAUSE_KEY = "trace_processing/projection/traceSummary";
const SEVEN_HOURS_MS = 7 * 60 * 60 * 1000;

let redis: Redis;
let scripts: GroupStagingScripts;

const keyPrefix = () => `${QUEUE_NAME}:gq:`;
const jobsKey = (groupId: string) => `${keyPrefix()}group:${groupId}:jobs`;
const dataKey = (groupId: string) => `${keyPrefix()}group:${groupId}:data`;

function routed({ pipeline, jobType, name }: { pipeline: string; jobType: string; name: string }) {
  const header = JSON.stringify({ p: pipeline, t: jobType, n: name });
  return `GQ2|${Buffer.byteLength(header)}|${header}`;
}

function stage({
  groupId,
  stagedJobId,
  jobDataJson = JSON.stringify({ hello: "world" }),
}: {
  groupId: string;
  stagedJobId: string;
  jobDataJson?: string;
}) {
  return scripts.stage({
    stagedJobId,
    groupId,
    dispatchAfterMs: 1000,
    dedupId: "",
    dedupTtlMs: 0,
    jobDataJson,
    shouldExtend: true,
    shouldReplace: true,
  });
}

async function keyTtls(groupId: string): Promise<number[]> {
  return [await redis.pttl(jobsKey(groupId)), await redis.pttl(dataKey(groupId))];
}

/** Applies the reaper as ops runs it hourly, with every staged job hours older than its cutoff. */
function reapPastTheCutoff() {
  return reapStrandedGroups({
    redis,
    keyPrefix: keyPrefix(),
    minAgeHours: 6,
    apply: true,
    now: () => 1000 + SEVEN_HOURS_MS,
  });
}

/** A group nothing will dispatch: jobs staged, then dropped out of ready by hand. */
async function stageStrandedGroup(groupId: string): Promise<void> {
  await stage({ groupId, stagedJobId: "stranded-1" });
  await redis.zrem(`${keyPrefix()}ready`, groupId);
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

function requireSetup({ holds, what }: { holds: boolean; what: string }): void {
  if (!holds) throw new Error(`setup failed: ${what}`);
}

describe("given a group parked at its tenant's in-flight cap", () => {
  const running = "project_A/fold/trace:1";
  const parked = "project_A/fold/trace:2";

  beforeEach(async () => {
    scripts = new GroupStagingScripts(redis, QUEUE_NAME, { tenantConcurrencyCap: 1 });
    await stage({ groupId: running, stagedJobId: "running-1" });
    await stage({ groupId: parked, stagedJobId: "parked-1" });
    const first = await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 });
    requireSetup({ holds: first?.groupId === running, what: "the running group dispatches" });
    const second = await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 });
    requireSetup({ holds: second === null, what: "the second group waits" });
    const score = await redis.zscore(`${keyPrefix()}parked:project_A`, parked);
    requireSetup({ holds: score !== null, what: "the second group parks at the cap" });
  });

  describe("when it waits", () => {
    /** @scenario "A parked group's keys carry no expiry while it waits" */
    it("holds its jobs and data keys without a TTL", async () => {
      expect(await keyTtls(parked)).toEqual([-1, -1]);
    });

    /** @scenario "A stage into a parked group does not re-arm the expiry" */
    it("keeps them without a TTL when another job is staged into it", async () => {
      await stage({ groupId: parked, stagedJobId: "parked-2" });

      expect(await redis.zcard(jobsKey(parked))).toBe(2);
      expect(await keyTtls(parked)).toEqual([-1, -1]);
    });
  });

  describe("when the reaper applies hours past its cutoff", () => {
    /** @scenario "A group parked at its tenant's cap survives a reap past the cutoff" */
    it("deletes the stranded group and leaves the parked one whole", async () => {
      await stageStrandedGroup("project_Z/fold/trace:9");

      const report = await reapPastTheCutoff();

      expect(report.groups.map((group) => group.groupId)).toEqual(["project_Z/fold/trace:9"]);
      expect(report.deletedGroups).toBe(1);
      expect(await redis.zrange(jobsKey(parked), 0, -1)).toEqual(["parked-1"]);
      expect(await redis.hkeys(dataKey(parked))).toEqual(["parked-1"]);
    });
  });

  describe("when the running group completes and frees the slot", () => {
    /** @scenario "An unparked group gets its safety-net expiry back" */
    it("moves it back to ready with a TTL on its keys", async () => {
      await scripts.complete({ groupId: running, stagedJobId: "running-1" });

      expect(await redis.zscore(`${keyPrefix()}ready`, parked)).not.toBeNull();
      const [jobsTtl, dataTtl] = await keyTtls(parked);
      expect(jobsTtl).toBeGreaterThan(0);
      expect(dataTtl).toBeGreaterThan(0);
    });
  });
});

describe("given a group parked behind a paused lane", () => {
  const laneParked = "project_B/fold/traceSummary/trace:1";
  const pausedLaneJob = routed({
    pipeline: "trace_processing",
    jobType: "projection",
    name: "traceSummary",
  });

  beforeEach(async () => {
    scripts = new GroupStagingScripts(redis, QUEUE_NAME);
    await stage({ groupId: laneParked, stagedJobId: "lane-1", jobDataJson: pausedLaneJob });
    await stage({ groupId: laneParked, stagedJobId: "lane-2", jobDataJson: pausedLaneJob });
    await scripts.addPauseKey(PAUSE_KEY);
    const dispatched = await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 });
    requireSetup({ holds: dispatched === null, what: "the paused lane dispatches nothing" });
    const score = await redis.zscore(`${keyPrefix()}parked-lane:${PAUSE_KEY}`, laneParked);
    requireSetup({ holds: score !== null, what: "the group parks behind the paused lane" });
  });

  describe("when the reaper applies hours past its cutoff", () => {
    /** @scenario "A group parked behind a paused lane keeps its keys" */
    it("holds them without a TTL and does not delete them", async () => {
      expect(await keyTtls(laneParked)).toEqual([-1, -1]);

      const report = await reapPastTheCutoff();

      expect(report.groups).toEqual([]);
      expect(await redis.zcard(jobsKey(laneParked))).toBe(2);
    });
  });

  describe("when another job is staged into it", () => {
    /** @scenario "A stage into a group parked behind a paused lane does not re-arm the expiry" */
    it("keeps its jobs and data keys without a TTL", async () => {
      await stage({ groupId: laneParked, stagedJobId: "lane-3", jobDataJson: pausedLaneJob });

      expect(await redis.zcard(jobsKey(laneParked))).toBe(3);
      expect(await keyTtls(laneParked)).toEqual([-1, -1]);
    });
  });

  describe("when it was parked before the queue counted lane parks", () => {
    beforeEach(async () => {
      await redis.del(
        `${keyPrefix()}lane-parked-groups`,
        `${keyPrefix()}lane-parked-groups:counted`,
      );
    });

    /** @scenario "A group lane-parked before lane parks were counted keeps its keys" */
    it("keeps them without a TTL when another job is staged, and expires them once unpaused", async () => {
      await stage({ groupId: laneParked, stagedJobId: "lane-3", jobDataJson: pausedLaneJob });
      expect(await keyTtls(laneParked)).toEqual([-1, -1]);

      await scripts.removePauseKey(PAUSE_KEY);
      await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 });

      expect(await redis.hexists(`${keyPrefix()}lane-parked-groups`, laneParked)).toBe(0);
      const [jobsTtl, dataTtl] = await keyTtls(laneParked);
      expect(jobsTtl).toBeGreaterThan(0);
      expect(dataTtl).toBeGreaterThan(0);
    });
  });

  describe("when the lane is unpaused", () => {
    /** @scenario "An unpaused lane's group gets its safety-net expiry back" */
    it("restores the group with a TTL on its keys", async () => {
      await scripts.removePauseKey(PAUSE_KEY);
      await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 });

      expect(await redis.zcard(`${keyPrefix()}parked-lane:${PAUSE_KEY}`)).toBe(0);
      const [jobsTtl, dataTtl] = await keyTtls(laneParked);
      expect(jobsTtl).toBeGreaterThan(0);
      expect(dataTtl).toBeGreaterThan(0);
    });
  });
});

describe("given a group the reaper discovered as stranded", () => {
  const stranded = "project_Z/fold/trace:9";
  const deleteAtCutoff = () =>
    deleteStrandedGroup({
      redis,
      keyPrefix: keyPrefix(),
      groupId: stranded,
      cutoffMs: 1000 + 60 * 60 * 1000,
    });

  beforeEach(async () => {
    scripts = new GroupStagingScripts(redis, QUEUE_NAME);
    await stageStrandedGroup(stranded);
  });

  describe.each([
    { membership: "ready", enter: () => redis.zadd(`${keyPrefix()}ready`, 1000, stranded) },
    { membership: "active", enter: () => redis.set(`${keyPrefix()}group:${stranded}:active`, "w") },
    { membership: "blocked", enter: () => redis.sadd(`${keyPrefix()}blocked`, stranded) },
    {
      membership: "its tenant's parked set",
      enter: () => redis.zadd(`${keyPrefix()}parked:project_Z`, 1000, stranded),
    },
    {
      membership: "a paused lane's parked set",
      enter: async () => {
        await redis.zadd(`${keyPrefix()}parked-lane:${PAUSE_KEY}`, 1000, stranded);
        await redis.sadd(`${keyPrefix()}parked-lanes`, PAUSE_KEY);
      },
    },
  ])("when it enters $membership before the delete", ({ enter }) => {
    /** @scenario "The stranded-group reaper deletes a group only if it is still stranded" */
    it("leaves its jobs and data whole", async () => {
      await enter();

      expect(await deleteAtCutoff()).toBe(false);
      expect(await redis.zrange(jobsKey(stranded), 0, -1)).toEqual(["stranded-1"]);
      expect(await redis.hkeys(dataKey(stranded))).toEqual(["stranded-1"]);
    });
  });

  describe("when a job newer than the cutoff is staged into it before the delete", () => {
    /** @scenario "The stranded-group reaper deletes a group only if it is still stranded" */
    it("leaves its jobs and data whole", async () => {
      await redis.zadd(jobsKey(stranded), 1000 + 2 * 60 * 60 * 1000, "fresh-1");

      expect(await deleteAtCutoff()).toBe(false);
      expect(await redis.zcard(jobsKey(stranded))).toBe(2);
    });
  });

  describe("when it is still stranded at the delete", () => {
    /** @scenario "The stranded-group reaper deletes a group only if it is still stranded" */
    it("deletes its jobs and data keys", async () => {
      expect(await deleteAtCutoff()).toBe(true);
      expect(await redis.exists(jobsKey(stranded), dataKey(stranded))).toBe(0);
    });
  });
});
