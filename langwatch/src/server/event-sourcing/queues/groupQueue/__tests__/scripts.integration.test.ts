import type { Redis } from "ioredis";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { QueueRedisRepository } from "../../../../app-layer/ops/repositories/queue.redis.repository";
import {
  getTestRedisConnection,
  startTestContainers,
  stopTestContainers,
} from "../../../__tests__/integration/testContainers";
import { encodeJobEnvelope } from "../jobEnvelope";
import {
  type DispatchResult,
  GROUP_KEY_TTL_MS,
  GROUP_QUEUE_REGISTRY_KEY,
  GroupStagingScripts,
  PARK_RECONCILE_MAX_DRAIN,
} from "../scripts";

let redis: Redis;
let scripts: GroupStagingScripts;
const QUEUE_NAME = "{test/scripts}";

function keyPrefix() {
  return `${QUEUE_NAME}:gq:`;
}

async function inspectGroupJobs(groupId: string) {
  return redis.zrangebyscore(
    `${keyPrefix()}group:${groupId}:jobs`,
    "-inf",
    "+inf",
    "WITHSCORES",
  );
}

async function inspectActiveKey(groupId: string) {
  return redis.get(`${keyPrefix()}group:${groupId}:active`);
}

async function inspectReadySet() {
  return redis.zrange(`${keyPrefix()}ready`, 0, -1, "WITHSCORES");
}

async function inspectBlockedSet() {
  return redis.smembers(`${keyPrefix()}blocked`);
}

async function inspectSignalList() {
  return redis.lrange(`${keyPrefix()}signal`, 0, -1);
}

async function inspectDataHash(groupId: string) {
  return redis.hgetall(`${keyPrefix()}group:${groupId}:data`);
}

async function inspectDedupKey(dedupId: string) {
  return redis.get(`${keyPrefix()}dedup:${dedupId}`);
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

beforeAll(async () => {
  await startTestContainers();
  redis = getTestRedisConnection()!;
});

beforeEach(async () => {
  await redis.flushall();
  scripts = new GroupStagingScripts(redis, QUEUE_NAME);
});

afterAll(async () => {
  await stopTestContainers();
});

describe("GroupStagingScripts", () => {
  describe("stage", () => {
    describe("when staging a new job", () => {
      it("adds job to group sorted set with correct score", async () => {
        await scripts.stage(
          makeJob({ stagedJobId: "j1", dispatchAfterMs: 5000 }),
        );

        const jobs = await inspectGroupJobs("group-a");
        expect(jobs).toEqual(["j1", "5000"]);
      });

      it("stores payload in data hash", async () => {
        const payload = JSON.stringify({ key: "value" });
        await scripts.stage(
          makeJob({ stagedJobId: "j1", jobDataJson: payload }),
        );

        const data = await inspectDataHash("group-a");
        expect(data).toEqual({ j1: payload });
      });

      it("adds group to ready set with score = earliest pending dispatchAfter", async () => {
        await scripts.stage(makeJob({ dispatchAfterMs: 1000 }));

        const ready = await inspectReadySet();
        expect(ready).toEqual(["group-a", "1000"]);
      });

      it("pushes signal", async () => {
        await scripts.stage(makeJob());

        const signals = await inspectSignalList();
        expect(signals.length).toBeGreaterThanOrEqual(1);
      });

      it("returns true for new job", async () => {
        const { isNew: result } = await scripts.stage(makeJob());
        expect(result).toBe(true);
      });
    });

    describe("when staging with deduplication", () => {
      describe("when dedup key exists", () => {
        it("squashes onto original job, returns false", async () => {
          const { isNew: first } = await scripts.stage(
            makeJob({
              stagedJobId: "j1",
              dedupId: "dedup-1",
              dedupTtlMs: 60000,
              jobDataJson: JSON.stringify({ version: 1 }),
            }),
          );
          expect(first).toBe(true);

          const { isNew: second } = await scripts.stage(
            makeJob({
              stagedJobId: "j2",
              dedupId: "dedup-1",
              dedupTtlMs: 60000,
              jobDataJson: JSON.stringify({ version: 2 }),
            }),
          );
          expect(second).toBe(false);

          // j1 stays (squash-in-place keeps original ID)
          const jobs = await inspectGroupJobs("group-a");
          expect(jobs[0]).toBe("j1");

          // Data updated to j2's payload, keyed under j1
          const data = await inspectDataHash("group-a");
          expect(data.j1).toBe(JSON.stringify({ version: 2 }));
          expect(data.j2).toBeUndefined();
        });
      });

      describe("when dedup key has expired", () => {
        it("stages as new, returns true", async () => {
          await scripts.stage(
            makeJob({
              stagedJobId: "j1",
              dedupId: "dedup-exp",
              dedupTtlMs: 1, // 1ms TTL — will expire immediately
            }),
          );

          // Wait for TTL to expire
          await new Promise((r) => setTimeout(r, 10));

          const { isNew: result } = await scripts.stage(
            makeJob({
              stagedJobId: "j2",
              dedupId: "dedup-exp",
              dedupTtlMs: 60000,
            }),
          );

          expect(result).toBe(true);

          // Both jobs should be in the set
          const jobs = await inspectGroupJobs("group-a");
          expect(jobs).toContain("j1");
          expect(jobs).toContain("j2");
        });
      });
    });

    describe("squash-in-place deduplication", () => {
      it("keeps original stagedJobId, updates data and score", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            dedupId: "squash-1",
            dedupTtlMs: 60000,
            dispatchAfterMs: 1000,
            jobDataJson: JSON.stringify({ version: 1 }),
          }),
        );

        const { isNew: result } = await scripts.stage(
          makeJob({
            stagedJobId: "j2",
            dedupId: "squash-1",
            dedupTtlMs: 60000,
            dispatchAfterMs: 2000,
            jobDataJson: JSON.stringify({ version: 2 }),
          }),
        );

        expect(result).toBe(false);

        const jobs = await inspectGroupJobs("group-a");
        expect(jobs).toEqual(["j1", "2000"]);

        const data = await inspectDataHash("group-a");
        expect(data.j1).toBe(JSON.stringify({ version: 2 }));
        expect(data.j2).toBeUndefined();

        const dedupValue = await inspectDedupKey("squash-1");
        expect(dedupValue).toBe("j1");
      });

      it("accumulates correctly across triple squash", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            dedupId: "triple-1",
            dedupTtlMs: 60000,
            dispatchAfterMs: 1000,
            jobDataJson: JSON.stringify({ v: 1 }),
          }),
        );
        await scripts.stage(
          makeJob({
            stagedJobId: "j2",
            dedupId: "triple-1",
            dedupTtlMs: 60000,
            dispatchAfterMs: 2000,
            jobDataJson: JSON.stringify({ v: 2 }),
          }),
        );
        await scripts.stage(
          makeJob({
            stagedJobId: "j3",
            dedupId: "triple-1",
            dedupTtlMs: 60000,
            dispatchAfterMs: 3000,
            jobDataJson: JSON.stringify({ v: 3 }),
          }),
        );

        const jobs = await inspectGroupJobs("group-a");
        expect(jobs).toEqual(["j1", "3000"]);

        const data = await inspectDataHash("group-a");
        expect(data.j1).toBe(JSON.stringify({ v: 3 }));

        const dedupValue = await inspectDedupKey("triple-1");
        expect(dedupValue).toBe("j1");
      });
    });

    describe("when dedup key exists but job already dispatched (TOCTOU race)", () => {
      it("treats as new job, not silent over-stage", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            dedupId: "race-1",
            dedupTtlMs: 60000,
            dispatchAfterMs: 0,
          }),
        );

        const dispatched = await scripts.dispatch({
          nowMs: Date.now(),
          activeTtlSec: 300,
        });
        expect(dispatched).not.toBeNull();
        expect(dispatched!.stagedJobId).toBe("j1");

        const jobsAfterDispatch = await inspectGroupJobs("group-a");
        expect(jobsAfterDispatch).toEqual([]);

        const { isNew: result } = await scripts.stage(
          makeJob({
            stagedJobId: "j2",
            dedupId: "race-1",
            dedupTtlMs: 60000,
            dispatchAfterMs: 5000,
          }),
        );

        expect(result).toBe(true);

        const jobs = await inspectGroupJobs("group-a");
        expect(jobs).toEqual(["j2", "5000"]);

        const active = await inspectActiveKey("group-a");
        expect(active).toBe("j1");

        const dedupValue = await inspectDedupKey("race-1");
        expect(dedupValue).toBe("j2");
      });

      it("handles race with multiple dispatch cycles", async () => {
        // Stage j1, dispatch it
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            dedupId: "multi-race",
            dedupTtlMs: 60000,
            dispatchAfterMs: 0,
          }),
        );
        await scripts.dispatch({ nowMs: Date.now(), activeTtlSec: 300 });

        // j2 is new (j1 dispatched)
        const { isNew: r2 } = await scripts.stage(
          makeJob({
            stagedJobId: "j2",
            dedupId: "multi-race",
            dedupTtlMs: 60000,
            dispatchAfterMs: 0,
          }),
        );
        expect(r2).toBe(true);

        // Complete j1, dispatch j2
        await scripts.complete({ groupId: "group-a", stagedJobId: "j1" });
        await scripts.dispatch({ nowMs: Date.now(), activeTtlSec: 300 });

        // j3 is new (j2 dispatched)
        const { isNew: r3 } = await scripts.stage(
          makeJob({
            stagedJobId: "j3",
            dedupId: "multi-race",
            dedupTtlMs: 60000,
            dispatchAfterMs: 5000,
          }),
        );
        expect(r3).toBe(true);

        const jobs = await inspectGroupJobs("group-a");
        expect(jobs).toEqual(["j3", "5000"]);
      });
    });

    describe("when shouldSurviveDispatch is set and the job was already dispatched", () => {
      it("squashes the new job instead of re-staging it (no re-run after dispatch)", async () => {
        // Stage j1 with a dedup key configured to survive dispatch, then dispatch
        // it so it leaves staging while the dedup key's TTL is still alive.
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            dedupId: "survive-1",
            dedupTtlMs: 60000,
            dispatchAfterMs: 0,
            shouldSurviveDispatch: true,
          }),
        );

        const dispatched = await scripts.dispatch({
          nowMs: Date.now(),
          activeTtlSec: 300,
        });
        expect(dispatched).not.toBeNull();
        expect(dispatched!.stagedJobId).toBe("j1");
        expect(await inspectGroupJobs("group-a")).toEqual([]);

        // A late re-trigger stages the same dedup id AFTER dispatch. With
        // shouldSurviveDispatch the still-alive TTL is HONORED: the new job is squashed
        // (isNew=false) rather than DEL+restaged as the default TOCTOU path does.
        const { isNew } = await scripts.stage(
          makeJob({
            stagedJobId: "j2",
            dedupId: "survive-1",
            dedupTtlMs: 60000,
            dispatchAfterMs: 5000,
            shouldSurviveDispatch: true,
          }),
        );

        expect(isNew).toBe(false);
        // No new job staged for the group — the duplicate is squashed.
        expect(await inspectGroupJobs("group-a")).toEqual([]);
        // The dedup key is preserved (still the dispatched job), not deleted.
        expect(await inspectDedupKey("survive-1")).toBe("j1");
        // The originally dispatched job stays active and untouched.
        expect(await inspectActiveKey("group-a")).toBe("j1");
      });
    });

    describe("extend/replace flags", () => {
      it("updates score when extend is true", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            dedupId: "ext-true",
            dedupTtlMs: 60000,
            dispatchAfterMs: 1000,
            shouldExtend: true,
          }),
        );
        await scripts.stage(
          makeJob({
            stagedJobId: "j2",
            dedupId: "ext-true",
            dedupTtlMs: 60000,
            dispatchAfterMs: 5000,
            shouldExtend: true,
          }),
        );

        const jobs = await inspectGroupJobs("group-a");
        expect(jobs).toEqual(["j1", "5000"]);
      });

      it("preserves original score when extend is false", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            dedupId: "ext-false",
            dedupTtlMs: 60000,
            dispatchAfterMs: 1000,
            shouldExtend: true,
          }),
        );
        await scripts.stage(
          makeJob({
            stagedJobId: "j2",
            dedupId: "ext-false",
            dedupTtlMs: 60000,
            dispatchAfterMs: 9999,
            shouldExtend: false,
          }),
        );

        const jobs = await inspectGroupJobs("group-a");
        expect(jobs).toEqual(["j1", "1000"]);

        // Dedup key should still exist (TTL refreshed)
        const dedupValue = await inspectDedupKey("ext-false");
        expect(dedupValue).toBe("j1");
      });

      it("preserves original data when replace is false", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            dedupId: "rep-false",
            dedupTtlMs: 60000,
            jobDataJson: JSON.stringify({ original: true }),
            shouldReplace: true,
          }),
        );
        await scripts.stage(
          makeJob({
            stagedJobId: "j2",
            dedupId: "rep-false",
            dedupTtlMs: 60000,
            jobDataJson: JSON.stringify({ updated: true }),
            shouldReplace: false,
          }),
        );

        const data = await inspectDataHash("group-a");
        expect(data.j1).toBe(JSON.stringify({ original: true }));
      });

      it("updates data when replace is true", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            dedupId: "rep-true",
            dedupTtlMs: 60000,
            jobDataJson: JSON.stringify({ v: 1 }),
            shouldReplace: true,
          }),
        );
        await scripts.stage(
          makeJob({
            stagedJobId: "j2",
            dedupId: "rep-true",
            dedupTtlMs: 60000,
            jobDataJson: JSON.stringify({ v: 2 }),
            shouldReplace: true,
          }),
        );

        const data = await inspectDataHash("group-a");
        expect(data.j1).toBe(JSON.stringify({ v: 2 }));
      });

      it("keeps both score and data unchanged with extend:false + replace:false", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            dedupId: "both-false",
            dedupTtlMs: 60000,
            dispatchAfterMs: 5000,
            jobDataJson: JSON.stringify({ first: true }),
            shouldExtend: false,
            shouldReplace: false,
          }),
        );

        const { isNew: result } = await scripts.stage(
          makeJob({
            stagedJobId: "j2",
            dedupId: "both-false",
            dedupTtlMs: 60000,
            dispatchAfterMs: 9999,
            jobDataJson: JSON.stringify({ second: true }),
            shouldExtend: false,
            shouldReplace: false,
          }),
        );

        expect(result).toBe(false);

        const jobs = await inspectGroupJobs("group-a");
        expect(jobs).toEqual(["j1", "5000"]);

        const data = await inspectDataHash("group-a");
        expect(data.j1).toBe(JSON.stringify({ first: true }));

        const dedupValue = await inspectDedupKey("both-false");
        expect(dedupValue).toBe("j1");
      });

      it("keeps schedule but updates payload with extend:false + replace:true", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            dedupId: "ext-false-rep-true",
            dedupTtlMs: 60000,
            dispatchAfterMs: 1000,
            jobDataJson: JSON.stringify({ v: 1 }),
            shouldExtend: false,
            shouldReplace: true,
          }),
        );
        await scripts.stage(
          makeJob({
            stagedJobId: "j2",
            dedupId: "ext-false-rep-true",
            dedupTtlMs: 60000,
            dispatchAfterMs: 9999,
            jobDataJson: JSON.stringify({ v: 2 }),
            shouldExtend: false,
            shouldReplace: true,
          }),
        );

        const jobs = await inspectGroupJobs("group-a");
        expect(jobs).toEqual(["j1", "1000"]);

        const data = await inspectDataHash("group-a");
        expect(data.j1).toBe(JSON.stringify({ v: 2 }));
      });
    });

    // A dedup squash drops one payload on the floor. When that payload carried
    // an offloaded blob (ADR-026) the blob would leak until its 7-day TTL (the
    // 2026-06-11 Redis capacity incident). stage()/stageBatch() report the
    // displaced value so GroupQueue can reclaim its blob; these lock the
    // reporting contract at the script layer (which is itself blob-agnostic).
    describe("given stage scripts report displaced values for blob reclamation", () => {
      describe("when a genuinely new job is staged", () => {
        it("reports no orphan", async () => {
          const { isNew, orphanedValue } = await scripts.stage(
            makeJob({
              stagedJobId: "j1",
              jobDataJson: JSON.stringify({ v: 1 }),
            }),
          );

          expect(isNew).toBe(true);
          expect(orphanedValue).toBe("");
        });
      });

      describe("when a dedup squash displaces a staged payload", () => {
        it("reports the displaced OLD value on replace", async () => {
          const oldValue = JSON.stringify({ v: 1 });
          await scripts.stage(
            makeJob({
              stagedJobId: "j1",
              dedupId: "orphan-replace",
              dedupTtlMs: 60000,
              jobDataJson: oldValue,
              shouldReplace: true,
            }),
          );

          const { isNew, orphanedValue } = await scripts.stage(
            makeJob({
              stagedJobId: "j2",
              dedupId: "orphan-replace",
              dedupTtlMs: 60000,
              jobDataJson: JSON.stringify({ v: 2 }),
              shouldReplace: true,
            }),
          );

          // v2 now occupies the field; v1 is dropped → its blob reclaims.
          expect(isNew).toBe(false);
          expect(orphanedValue).toBe(oldValue);
        });

        it("reports the discarded NEW value when the existing payload is kept", async () => {
          await scripts.stage(
            makeJob({
              stagedJobId: "j1",
              dedupId: "orphan-keep",
              dedupTtlMs: 60000,
              jobDataJson: JSON.stringify({ kept: true }),
              shouldExtend: false,
              shouldReplace: false,
            }),
          );

          const discardedValue = JSON.stringify({ discarded: true });
          const { isNew, orphanedValue } = await scripts.stage(
            makeJob({
              stagedJobId: "j2",
              dedupId: "orphan-keep",
              dedupTtlMs: 60000,
              jobDataJson: discardedValue,
              shouldExtend: false,
              shouldReplace: false,
            }),
          );

          // The existing payload stays; the new value never lands → ITS blob reclaims.
          expect(isNew).toBe(false);
          expect(orphanedValue).toBe(discardedValue);
        });

        it("reports per-job orphans index-aligned in a batch", async () => {
          // Pre-stage j0 so the first batch entry squash-replaces it in place.
          await scripts.stage(
            makeJob({
              stagedJobId: "j0",
              groupId: "group-a",
              dedupId: "batch-orphan",
              dedupTtlMs: 60000,
              jobDataJson: JSON.stringify({ v: 1 }),
              shouldReplace: true,
            }),
          );

          const { newStagedCount, orphanedValues } = await scripts.stageBatch([
            makeJob({
              stagedJobId: "j1",
              groupId: "group-a",
              dedupId: "batch-orphan",
              dedupTtlMs: 60000,
              jobDataJson: JSON.stringify({ v: 2 }),
              shouldReplace: true,
            }),
            makeJob({
              stagedJobId: "j2",
              groupId: "group-b",
              dedupId: "batch-fresh",
              dedupTtlMs: 60000,
              jobDataJson: JSON.stringify({ fresh: true }),
            }),
          ]);

          // Entry 0 squashed j0 (orphan = old v1); entry 1 is fresh (no orphan).
          expect(newStagedCount).toBe(1);
          expect(orphanedValues).toEqual([JSON.stringify({ v: 1 }), ""]);
        });
      });
    });

    describe("edge cases", () => {
      it("creates genuinely new job after dedup TTL expires", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            dedupId: "exp-1",
            dedupTtlMs: 1,
            dispatchAfterMs: 1000,
          }),
        );

        await new Promise((r) => setTimeout(r, 10));

        const { isNew: result } = await scripts.stage(
          makeJob({
            stagedJobId: "j2",
            dedupId: "exp-1",
            dedupTtlMs: 60000,
            dispatchAfterMs: 2000,
          }),
        );

        expect(result).toBe(true);

        const jobs = await inspectGroupJobs("group-a");
        expect(jobs).toContain("j1");
        expect(jobs).toContain("j2");
      });

      it("does not interfere across different dedup IDs in different groups", async () => {
        const { isNew: r1 } = await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            groupId: "group-a",
            dedupId: "cross-1",
            dedupTtlMs: 60000,
          }),
        );
        const { isNew: r2 } = await scripts.stage(
          makeJob({
            stagedJobId: "j2",
            groupId: "group-b",
            dedupId: "cross-2",
            dedupTtlMs: 60000,
          }),
        );

        expect(r1).toBe(true);
        expect(r2).toBe(true);

        const jobsA = await inspectGroupJobs("group-a");
        expect(jobsA).toContain("j1");

        const jobsB = await inspectGroupJobs("group-b");
        expect(jobsB).toContain("j2");
      });

      it("returns squashed data on dispatch after dedup squash", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            dedupId: "squash-dispatch",
            dedupTtlMs: 60000,
            dispatchAfterMs: 0,
            jobDataJson: JSON.stringify({ v: 1 }),
          }),
        );
        await scripts.stage(
          makeJob({
            stagedJobId: "j2",
            dedupId: "squash-dispatch",
            dedupTtlMs: 60000,
            dispatchAfterMs: 0,
            jobDataJson: JSON.stringify({ v: 2 }),
          }),
        );

        const dispatched = await scripts.dispatch({
          nowMs: Date.now(),
          activeTtlSec: 300,
        });
        expect(dispatched).not.toBeNull();
        expect(dispatched!.stagedJobId).toBe("j1");
        expect(dispatched!.jobDataJson).toBe(JSON.stringify({ v: 2 }));
      });

      it("does not leak data hash entries on race condition", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            dedupId: "leak-check",
            dedupTtlMs: 60000,
            dispatchAfterMs: 0,
          }),
        );

        // Dispatch cleans data hash for j1
        await scripts.dispatch({ nowMs: Date.now(), activeTtlSec: 300 });

        await scripts.stage(
          makeJob({
            stagedJobId: "j2",
            dedupId: "leak-check",
            dedupTtlMs: 60000,
            dispatchAfterMs: 5000,
          }),
        );

        const data = await inspectDataHash("group-a");
        expect(data.j2).toBeDefined();
        expect(data.j1).toBeUndefined();
      });
    });

    describe("when group is currently active", () => {
      it("does not lower ready score below the active-until window", async () => {
        // Seed an active job and an active-until ready score
        await scripts.stage(
          makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }),
        );
        const nowMs = 200;
        const activeTtlSec = 60;
        const activeUntil = nowMs + activeTtlSec * 1000;
        await scripts.dispatch({ nowMs, activeTtlSec });

        // Stage another job for the same group while it is processing
        await scripts.stage(
          makeJob({ stagedJobId: "j2", dispatchAfterMs: 150 }),
        );

        // Ready score must remain at activeUntil so dispatch doesn't re-pick the group
        const ready = await inspectReadySet();
        expect(ready).toEqual(["group-a", String(activeUntil)]);
      });

      it("still stores the new job in the group jobs zset", async () => {
        await scripts.stage(
          makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }),
        );
        await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });

        await scripts.stage(
          makeJob({ stagedJobId: "j2", dispatchAfterMs: 150 }),
        );

        const jobs = await inspectGroupJobs("group-a");
        expect(jobs).toContain("j2");
      });
    });

    describe("when group is blocked", () => {
      it("does not re-add a blocked group to the ready set", async () => {
        await scripts.stage(
          makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }),
        );
        await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        await scripts.restageAndBlock({
          groupId: "group-a",
          newStagedJobId: "j1/r/0",
          score: 100,
          jobDataJson: JSON.stringify({ retry: true }),
        });

        // Sanity: group is blocked and not in ready
        expect(await inspectBlockedSet()).toContain("group-a");
        expect(await inspectReadySet()).toEqual([]);

        // Stage a new job for the blocked group — should not reinsert it
        await scripts.stage(
          makeJob({ stagedJobId: "j2", dispatchAfterMs: 150 }),
        );

        expect(await inspectReadySet()).toEqual([]);
      });
    });
  });

  describe("stageBatch", () => {
    describe("when staging for different groups", () => {
      it("creates entries per group and pushes signal", async () => {
        const jobs = [
          makeJob({
            stagedJobId: "j1",
            groupId: "group-x",
            dispatchAfterMs: 100,
          }),
          makeJob({
            stagedJobId: "j2",
            groupId: "group-y",
            dispatchAfterMs: 200,
          }),
        ];

        await scripts.stageBatch(jobs);

        const jobsX = await inspectGroupJobs("group-x");
        expect(jobsX).toEqual(["j1", "100"]);

        const jobsY = await inspectGroupJobs("group-y");
        expect(jobsY).toEqual(["j2", "200"]);

        const signals = await inspectSignalList();
        expect(signals.length).toBeGreaterThanOrEqual(1);
      });

      it("returns new count excluding deduped", async () => {
        // Stage first job with dedup
        await scripts.stage(
          makeJob({
            stagedJobId: "j0",
            groupId: "group-x",
            dedupId: "dup-batch",
            dedupTtlMs: 60000,
          }),
        );

        // Batch includes a dedup replacement and a new job
        const { newStagedCount: count } = await scripts.stageBatch([
          makeJob({
            stagedJobId: "j1",
            groupId: "group-x",
            dedupId: "dup-batch",
            dedupTtlMs: 60000,
          }),
          makeJob({ stagedJobId: "j2", groupId: "group-y" }),
        ]);

        // j1 replaces j0 (dedup), j2 is new
        expect(count).toBe(1);
      });
    });

    describe("when batch contains race condition", () => {
      it("treats dispatched dedup as new, squashes staged dedup", async () => {
        // j0 with dedupId "batch-race", dispatch it
        await scripts.stage(
          makeJob({
            stagedJobId: "j0",
            groupId: "group-x",
            dedupId: "batch-race",
            dedupTtlMs: 60000,
            dispatchAfterMs: 0,
          }),
        );
        await scripts.dispatch({ nowMs: Date.now(), activeTtlSec: 300 });

        // Batch: j1 has same dedup (race — j0 already dispatched), j2 is no dedup
        const { newStagedCount: count } = await scripts.stageBatch([
          makeJob({
            stagedJobId: "j1",
            groupId: "group-x",
            dedupId: "batch-race",
            dedupTtlMs: 60000,
            dispatchAfterMs: 5000,
          }),
          makeJob({
            stagedJobId: "j2",
            groupId: "group-y",
            dispatchAfterMs: 1000,
          }),
        ]);

        // Both are new (j1 because of race, j2 because no dedup)
        expect(count).toBe(2);

        const jobsX = await inspectGroupJobs("group-x");
        expect(jobsX).toContain("j1");
        expect(jobsX).not.toContain("j0");

        const jobsY = await inspectGroupJobs("group-y");
        expect(jobsY).toContain("j2");
      });
    });

    describe("when batch has mix of squash and race", () => {
      it("squashes staged dedup and creates new for dispatched dedup", async () => {
        // j0 still in staging with dedupId "mix-a"
        await scripts.stage(
          makeJob({
            stagedJobId: "j0",
            groupId: "group-a",
            dedupId: "mix-a",
            dedupTtlMs: 60000,
            dispatchAfterMs: 1000,
            jobDataJson: JSON.stringify({ from: "j0" }),
          }),
        );

        // j1 dispatched with dedupId "mix-b"
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            groupId: "group-a",
            dedupId: "mix-b",
            dedupTtlMs: 60000,
            dispatchAfterMs: 0,
          }),
        );
        await scripts.dispatch({ nowMs: Date.now(), activeTtlSec: 300 });

        // Batch: j2 squashes onto j0 (mix-a), j3 is new (mix-b race)
        const { newStagedCount: count } = await scripts.stageBatch([
          makeJob({
            stagedJobId: "j2",
            groupId: "group-a",
            dedupId: "mix-a",
            dedupTtlMs: 60000,
            dispatchAfterMs: 2000,
            jobDataJson: JSON.stringify({ from: "j2" }),
          }),
          makeJob({
            stagedJobId: "j3",
            groupId: "group-a",
            dedupId: "mix-b",
            dedupTtlMs: 60000,
            dispatchAfterMs: 3000,
          }),
        ]);

        // j2 squashed (0 new), j3 is new (1 new)
        expect(count).toBe(1);

        const jobs = await inspectGroupJobs("group-a");
        // j0 should still be there (squashed with j2's data)
        expect(jobs).toContain("j0");
        // j3 should be there as new
        expect(jobs).toContain("j3");

        const data = await inspectDataHash("group-a");
        expect(data.j0).toBe(JSON.stringify({ from: "j2" }));
      });
    });

    describe("when shouldSurviveDispatch is set and a batch dedup was already dispatched", () => {
      it("squashes the dispatched-dedup job instead of staging it as new", async () => {
        // j0 staged with a survives-dispatch dedup, then dispatched (left staging
        // while its dedup key TTL is still alive).
        await scripts.stage(
          makeJob({
            stagedJobId: "j0",
            groupId: "group-x",
            dedupId: "batch-survive",
            dedupTtlMs: 60000,
            dispatchAfterMs: 0,
            shouldSurviveDispatch: true,
          }),
        );
        await scripts.dispatch({ nowMs: Date.now(), activeTtlSec: 300 });

        // Batch: j1 re-triggers the same (already-dispatched) dedup with
        // shouldSurviveDispatch, j2 has no dedup. Only j2 is new; j1 is squashed by the
        // surviving dedup key rather than DEL+restaged as the default race path does.
        const { newStagedCount, orphanedValues } = await scripts.stageBatch([
          makeJob({
            stagedJobId: "j1",
            groupId: "group-x",
            dedupId: "batch-survive",
            dedupTtlMs: 60000,
            dispatchAfterMs: 5000,
            shouldSurviveDispatch: true,
            jobDataJson: JSON.stringify({ from: "j1" }),
          }),
          makeJob({
            stagedJobId: "j2",
            groupId: "group-y",
            dispatchAfterMs: 1000,
          }),
        ]);

        // Only j2 is new; j1 was squashed by the surviving dedup key.
        expect(newStagedCount).toBe(1);
        // j1's payload is reported as the orphaned value (index-aligned with the
        // batch); j2 displaced nothing.
        expect(orphanedValues).toEqual([JSON.stringify({ from: "j1" }), ""]);

        const jobsX = await inspectGroupJobs("group-x");
        expect(jobsX).not.toContain("j1");
        expect(jobsX).not.toContain("j0");

        const jobsY = await inspectGroupJobs("group-y");
        expect(jobsY).toContain("j2");

        // The dedup key is preserved (still the dispatched job), not deleted.
        expect(await inspectDedupKey("batch-survive")).toBe("j0");
      });
    });

    describe("when a shouldSurviveDispatch batch squash targets an already-drained group", () => {
      it("does not resurrect the drained group into the ready set", async () => {
        // Stage j0 under a survives-dispatch dedup, dispatch it, then COMPLETE it
        // so the group fully drains: it leaves staging AND the ready set while the
        // dedup key's TTL is still alive.
        await scripts.stage(
          makeJob({
            stagedJobId: "j0",
            groupId: "group-drain",
            dedupId: "drained-survive",
            dedupTtlMs: 60000,
            dispatchAfterMs: 0,
            shouldSurviveDispatch: true,
          }),
        );
        await scripts.dispatch({ nowMs: Date.now(), activeTtlSec: 300 });
        await scripts.complete({ groupId: "group-drain", stagedJobId: "j0" });

        // Precondition: the group is drained — gone from ready and from staging.
        expect(
          await redis.zscore(`${keyPrefix()}ready`, "group-drain"),
        ).toBeNull();
        expect(await inspectGroupJobs("group-drain")).toEqual([]);

        // A late re-trigger batches ONLY the same (already-dispatched) dedup with
        // shouldSurviveDispatch. It is squashed (stages no job), so the group must
        // NOT be re-added to ready — doing so would resurrect a drained, empty
        // group into the dispatch scan after the loop.
        const { newStagedCount } = await scripts.stageBatch([
          makeJob({
            stagedJobId: "j1",
            groupId: "group-drain",
            dedupId: "drained-survive",
            dedupTtlMs: 60000,
            dispatchAfterMs: 5000,
            shouldSurviveDispatch: true,
          }),
        ]);

        // The squash staged nothing...
        expect(newStagedCount).toBe(0);
        // ...and did NOT resurrect the drained group into ready.
        expect(
          await redis.zscore(`${keyPrefix()}ready`, "group-drain"),
        ).toBeNull();
        expect(await inspectReadySet()).toEqual([]);
        // Still drained from staging; the dedup key is preserved, not re-staged.
        expect(await inspectGroupJobs("group-drain")).toEqual([]);
        expect(await inspectDedupKey("drained-survive")).toBe("j0");
      });
    });
  });

  describe("dispatch", () => {
    describe("when group has eligible jobs", () => {
      it("returns oldest job (lowest score <= nowMs)", async () => {
        await scripts.stage(
          makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }),
        );
        await scripts.stage(
          makeJob({ stagedJobId: "j2", dispatchAfterMs: 200 }),
        );

        const result = await scripts.dispatch({ nowMs: 300, activeTtlSec: 60 });

        expect(result).not.toBeNull();
        expect(result!.stagedJobId).toBe("j1");
        expect(result!.groupId).toBe("group-a");
      });

      it("sets active key with TTL", async () => {
        await scripts.stage(
          makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }),
        );

        await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });

        const active = await inspectActiveKey("group-a");
        expect(active).toBe("j1");

        const ttl = await redis.ttl(`${keyPrefix()}group:group-a:active`);
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(60);
      });

      it("removes job from sorted set", async () => {
        await scripts.stage(
          makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }),
        );

        await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });

        const jobs = await inspectGroupJobs("group-a");
        expect(jobs).toEqual([]);
      });

      it("re-scores ready set with future activeUntil after dispatch", async () => {
        await scripts.stage(
          makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }),
        );
        await scripts.stage(
          makeJob({ stagedJobId: "j2", dispatchAfterMs: 200 }),
        );

        const nowMs = 300;
        const activeTtlSec = 60;
        await scripts.dispatch({ nowMs, activeTtlSec });

        // Group is now active → score = nowMs + activeTtlSec*1000 (suppresses redispatch)
        const ready = await inspectReadySet();
        expect(ready).toEqual(["group-a", String(nowMs + activeTtlSec * 1000)]);
      });

      it("keeps group in ready with future activeUntil score after dispatch (no pending left)", async () => {
        await scripts.stage(
          makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }),
        );

        const nowMs = 200;
        const activeTtlSec = 60;
        await scripts.dispatch({ nowMs, activeTtlSec });

        // Group is active even though no jobs remain — completion removes it from ready.
        const ready = await inspectReadySet();
        expect(ready).toEqual(["group-a", String(nowMs + activeTtlSec * 1000)]);
      });

      it("returns jobDataJson from data hash", async () => {
        const payload = JSON.stringify({ test: "data" });
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            dispatchAfterMs: 100,
            jobDataJson: payload,
          }),
        );

        const result = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        expect(result!.jobDataJson).toBe(payload);

        // Data should be cleaned up
        const data = await inspectDataHash("group-a");
        expect(data.j1).toBeUndefined();
      });
    });

    describe("when group has active key", () => {
      it("skips group, tries next", async () => {
        // Stage jobs in two groups
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            groupId: "group-a",
            dispatchAfterMs: 100,
          }),
        );
        await scripts.stage(
          makeJob({
            stagedJobId: "j2",
            groupId: "group-b",
            dispatchAfterMs: 100,
          }),
        );

        // Dispatch picks groups by ZRANGEBYSCORE (lowest dispatchAfter first); both groups have the same score.
        const first = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        expect(first).not.toBeNull();

        // Second dispatch should skip the active group and return the other
        const second = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        expect(second).not.toBeNull();
        expect(second!.groupId).not.toBe(first!.groupId);
      });
    });

    describe("when group is blocked", () => {
      it("skips group", async () => {
        await scripts.stage(
          makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }),
        );

        // Manually block the group
        await redis.sadd(`${keyPrefix()}blocked`, "group-a");

        const result = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        expect(result).toBeNull();
      });
    });

    describe("when no jobs eligible (future dispatchAfterMs)", () => {
      it("returns null", async () => {
        await scripts.stage(
          makeJob({ stagedJobId: "j1", dispatchAfterMs: 99999 }),
        );

        const result = await scripts.dispatch({ nowMs: 100, activeTtlSec: 60 });
        expect(result).toBeNull();
      });
    });

    describe("when ready set empty", () => {
      it("returns null", async () => {
        const result = await scripts.dispatch({
          nowMs: Date.now(),
          activeTtlSec: 60,
        });
        expect(result).toBeNull();
      });
    });
  });

  describe("complete", () => {
    async function stageAndDispatch(
      overrides: Partial<Parameters<typeof scripts.stage>[0]> = {},
    ): Promise<DispatchResult> {
      const job = makeJob({ dispatchAfterMs: 100, ...overrides });
      await scripts.stage(job);
      const result = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
      expect(result).not.toBeNull();
      return result!;
    }

    describe("when active key matches", () => {
      it("deletes active key, pushes signal, returns true", async () => {
        const dispatched = await stageAndDispatch({ stagedJobId: "j1" });

        const ok = await scripts.complete({
          groupId: dispatched.groupId,
          stagedJobId: dispatched.stagedJobId,
        });

        expect(ok).toBe(true);
        expect(await inspectActiveKey(dispatched.groupId)).toBeNull();

        const signals = await inspectSignalList();
        expect(signals.length).toBeGreaterThanOrEqual(1);
      });

      it("recalculates ready score from earliest pending job after completion", async () => {
        await scripts.stage(
          makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }),
        );
        await scripts.stage(
          makeJob({ stagedJobId: "j2", dispatchAfterMs: 200 }),
        );

        const dispatched = (await scripts.dispatch({
          nowMs: 300,
          activeTtlSec: 60,
        }))!;
        await scripts.complete({
          groupId: dispatched.groupId,
          stagedJobId: dispatched.stagedJobId,
        });

        // j2 still pending → ready score should equal j2's dispatchAfterMs (200)
        const ready = await inspectReadySet();
        expect(ready).toEqual(["group-a", "200"]);
      });

      it("removes group from ready set if no jobs remain", async () => {
        const dispatched = await stageAndDispatch({ stagedJobId: "j1" });

        await scripts.complete({
          groupId: dispatched.groupId,
          stagedJobId: dispatched.stagedJobId,
        });

        const ready = await inspectReadySet();
        expect(ready).not.toContain("group-a");
      });
    });

    describe("when active key stale", () => {
      it("returns false, does not delete", async () => {
        const dispatched = await stageAndDispatch({ stagedJobId: "j1" });

        // Overwrite the active key with a different job ID
        await redis.set(
          `${keyPrefix()}group:${dispatched.groupId}:active`,
          "some-other-job",
          "EX",
          60,
        );

        const ok = await scripts.complete({
          groupId: dispatched.groupId,
          stagedJobId: dispatched.stagedJobId,
        });

        expect(ok).toBe(false);
        // Active key should still have the other job
        expect(await inspectActiveKey(dispatched.groupId)).toBe(
          "some-other-job",
        );
      });
    });
  });

  describe("refreshActiveKey", () => {
    describe("when active key matches", () => {
      it("refreshes TTL, returns true", async () => {
        await scripts.stage(
          makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }),
        );
        await scripts.dispatch({ nowMs: 200, activeTtlSec: 10 });

        const ok = await scripts.refreshActiveKey({
          groupId: "group-a",
          stagedJobId: "j1",
          activeTtlSec: 120,
        });

        expect(ok).toBe(true);
        const ttl = await redis.ttl(`${keyPrefix()}group:group-a:active`);
        expect(ttl).toBeGreaterThan(10);
        expect(ttl).toBeLessThanOrEqual(120);
      });
    });

    describe("when stale", () => {
      it("returns false", async () => {
        const ok = await scripts.refreshActiveKey({
          groupId: "group-a",
          stagedJobId: "nonexistent",
          activeTtlSec: 60,
        });

        expect(ok).toBe(false);
      });
    });

    describe("when group was removed from ready (e.g. after blocking)", () => {
      it("does not re-add the group to the ready set", async () => {
        // Set up: group is processing a job, then gets blocked mid-flight
        await scripts.stage(
          makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }),
        );
        await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        await scripts.restageAndBlock({
          groupId: "group-a",
          newStagedJobId: "j1/r/0",
          score: 100,
          jobDataJson: JSON.stringify({ retry: true }),
        });

        // Sanity: group is no longer in ready
        expect(await inspectReadySet()).toEqual([]);

        // Heartbeat fires after blocking — must not reinsert the blocked group.
        // Post-2026-05-11 tenant-soft-cap change: RESTAGE_AND_BLOCK_LUA now
        // DEL's the activeKey atomically (so the tenant_active counter can
        // be DECR'd in lockstep without TTL drift). Consequence: a heartbeat
        // arriving AFTER restage sees no active lease and returns false.
        // Either way, the ready set must stay empty — that's the safety
        // property the test enforces.
        const ok = await scripts.refreshActiveKey({
          groupId: "group-a",
          stagedJobId: "j1",
          activeTtlSec: 60,
        });

        expect(ok).toBe(false);
        expect(await inspectReadySet()).toEqual([]);
      });
    });

    describe("when active and in ready", () => {
      it("refreshes ready score to nowMs + activeTtlSec*1000", async () => {
        await scripts.stage(
          makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }),
        );
        await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });

        // ZADD with smaller score to simulate score drift; heartbeat should push it forward.
        await redis.zadd(`${keyPrefix()}ready`, 200, "group-a");

        const ok = await scripts.refreshActiveKey({
          groupId: "group-a",
          stagedJobId: "j1",
          activeTtlSec: 120,
        });

        expect(ok).toBe(true);
        const score = await redis.zscore(`${keyPrefix()}ready`, "group-a");
        // Score must be in the future (nowMs + 120_000) — exact value depends on Date.now()
        expect(Number(score)).toBeGreaterThan(Date.now());
      });
    });
  });

  describe("restageAndBlock", () => {
    it("adds group to blocked set", async () => {
      await scripts.restageAndBlock({
        groupId: "group-a",
        newStagedJobId: "j1/r/123",
        score: 1000,
        jobDataJson: JSON.stringify({ payload: true }),
      });

      const blocked = await inspectBlockedSet();
      expect(blocked).toContain("group-a");
    });

    it("re-stages job with new ID", async () => {
      await scripts.restageAndBlock({
        groupId: "group-a",
        newStagedJobId: "j1/r/123",
        score: 5000,
        jobDataJson: JSON.stringify({ payload: true }),
      });

      const jobs = await inspectGroupJobs("group-a");
      expect(jobs).toEqual(["j1/r/123", "5000"]);
    });

    it("stores error info in error hash", async () => {
      await scripts.restageAndBlock({
        groupId: "group-a",
        newStagedJobId: "j1/r/123",
        score: 1000,
        jobDataJson: JSON.stringify({}),
        errorMessage: "Something broke",
        errorStack: "Error: Something broke\n  at test.ts:1",
      });

      const error = await scripts.getGroupError("group-a");
      expect(error).not.toBeNull();
      expect(error!.message).toBe("Something broke");
      expect(error!.stack).toContain("Something broke");
    });

    it("updates ready score", async () => {
      await scripts.restageAndBlock({
        groupId: "group-a",
        newStagedJobId: "j1/r/123",
        score: 1000,
        jobDataJson: JSON.stringify({}),
      });

      const ready = await inspectReadySet();
      // Blocked groups are removed from ready set — UNBLOCK_LUA re-adds them
      expect(ready).not.toContain("group-a");
    });
  });

  describe("lifecycle: stage -> dispatch -> complete -> next", () => {
    it("3 jobs same group: dispatches sequentially (FIFO)", async () => {
      await scripts.stage(makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }));
      await scripts.stage(makeJob({ stagedJobId: "j2", dispatchAfterMs: 200 }));
      await scripts.stage(makeJob({ stagedJobId: "j3", dispatchAfterMs: 300 }));

      // Dispatch first
      const r1 = await scripts.dispatch({ nowMs: 400, activeTtlSec: 60 });
      expect(r1!.stagedJobId).toBe("j1");

      // Can't dispatch another while group is active
      const blocked = await scripts.dispatch({ nowMs: 400, activeTtlSec: 60 });
      expect(blocked).toBeNull();

      // Complete first
      await scripts.complete({ groupId: "group-a", stagedJobId: "j1" });

      // Now dispatch second
      const r2 = await scripts.dispatch({ nowMs: 400, activeTtlSec: 60 });
      expect(r2!.stagedJobId).toBe("j2");

      await scripts.complete({ groupId: "group-a", stagedJobId: "j2" });

      // Dispatch third
      const r3 = await scripts.dispatch({ nowMs: 400, activeTtlSec: 60 });
      expect(r3!.stagedJobId).toBe("j3");

      await scripts.complete({ groupId: "group-a", stagedJobId: "j3" });

      // No more
      const empty = await scripts.dispatch({ nowMs: 400, activeTtlSec: 60 });
      expect(empty).toBeNull();
    });

    it("2 groups: dispatches in parallel", async () => {
      await scripts.stage(
        makeJob({
          stagedJobId: "a1",
          groupId: "group-a",
          dispatchAfterMs: 100,
        }),
      );
      await scripts.stage(
        makeJob({
          stagedJobId: "b1",
          groupId: "group-b",
          dispatchAfterMs: 100,
        }),
      );

      const r1 = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
      const r2 = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });

      expect(r1).not.toBeNull();
      expect(r2).not.toBeNull();

      const dispatched = new Set([r1!.groupId, r2!.groupId]);
      expect(dispatched).toEqual(new Set(["group-a", "group-b"]));
    });
  });

  describe("lifecycle: stage -> dispatch -> restageAndBlock", () => {
    it("blocks group, next dispatch skips it", async () => {
      await scripts.stage(makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }));

      const dispatched = (await scripts.dispatch({
        nowMs: 200,
        activeTtlSec: 60,
      }))!;
      expect(dispatched.stagedJobId).toBe("j1");

      // Simulate exhausted retries — restage and block
      await scripts.restageAndBlock({
        groupId: "group-a",
        newStagedJobId: "j1/r/1",
        score: 100,
        jobDataJson: dispatched.jobDataJson,
        errorMessage: "Timeout",
      });

      // Dispatch should skip the blocked group
      const result = await scripts.dispatch({ nowMs: 300, activeTtlSec: 60 });
      expect(result).toBeNull();
    });

    it("after manual SREM unblock, group dispatchable again", async () => {
      await scripts.stage(makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }));

      const dispatched = (await scripts.dispatch({
        nowMs: 200,
        activeTtlSec: 60,
      }))!;

      await scripts.restageAndBlock({
        groupId: "group-a",
        newStagedJobId: "j1/r/1",
        score: 100,
        jobDataJson: dispatched.jobDataJson,
      });

      // Manually unblock (mimics Skynet UNBLOCK_LUA action)
      await redis.srem(`${keyPrefix()}blocked`, "group-a");
      // Also clear the stale active key
      await redis.del(`${keyPrefix()}group:group-a:active`);
      // Re-add to ready set — restageAndBlock removes it, UNBLOCK_LUA re-adds
      await redis.zadd(`${keyPrefix()}ready`, 1, "group-a");

      const result = await scripts.dispatch({ nowMs: 300, activeTtlSec: 60 });
      expect(result).not.toBeNull();
      expect(result!.stagedJobId).toBe("j1/r/1");
    });
  });

  describe("dispatch", () => {
    describe("when head-of-line job is paused", () => {
      function makePausedJobData(
        overrides: Record<string, unknown> = {},
      ): string {
        return JSON.stringify({
          __pipelineName: "ingestion",
          __jobType: "projection",
          __jobName: "traceProjection",
          hello: "world",
          ...overrides,
        });
      }

      it("skips group whose head job matches a paused pipeline", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            dispatchAfterMs: 100,
            jobDataJson: makePausedJobData(),
          }),
        );
        await scripts.addPauseKey("ingestion");

        const result = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        expect(result).toBeNull();
      });

      it("skips group when paused at jobType level", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            dispatchAfterMs: 100,
            jobDataJson: makePausedJobData(),
          }),
        );
        await scripts.addPauseKey("ingestion/projection");

        const result = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        expect(result).toBeNull();
      });

      it("skips group when paused at jobType/jobName level", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            dispatchAfterMs: 100,
            jobDataJson: makePausedJobData(),
          }),
        );
        await scripts.addPauseKey("ingestion/projection/traceProjection");

        const result = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        expect(result).toBeNull();
      });

      it("dispatches non-paused groups while paused group is skipped", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            groupId: "group-paused",
            dispatchAfterMs: 100,
            jobDataJson: makePausedJobData(),
          }),
        );
        await scripts.stage(
          makeJob({
            stagedJobId: "j2",
            groupId: "group-ok",
            dispatchAfterMs: 100,
            jobDataJson: JSON.stringify({ hello: "world" }),
          }),
        );
        await scripts.addPauseKey("ingestion");

        const result = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        expect(result).not.toBeNull();
        expect(result!.groupId).toBe("group-ok");
        expect(result!.stagedJobId).toBe("j2");
      });

      it("does not dequeue paused job (preserves FIFO)", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            dispatchAfterMs: 100,
            jobDataJson: makePausedJobData(),
          }),
        );
        await scripts.addPauseKey("ingestion");

        await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });

        // Job should still be in the group's job queue
        const jobs = await inspectGroupJobs("group-a");
        expect(jobs).toContain("j1");

        // No active key should be set
        const active = await inspectActiveKey("group-a");
        expect(active).toBeNull();

        // Data hash should still have the job
        const data = await inspectDataHash("group-a");
        expect(data.j1).toBeDefined();
      });

      it("resumes dispatch immediately after pause key is removed", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            dispatchAfterMs: 100,
            jobDataJson: makePausedJobData(),
          }),
        );
        await scripts.addPauseKey("ingestion");

        const blocked = await scripts.dispatch({
          nowMs: 200,
          activeTtlSec: 60,
        });
        expect(blocked).toBeNull();

        await scripts.removePauseKey("ingestion");

        const result = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        expect(result).not.toBeNull();
        expect(result!.stagedJobId).toBe("j1");
      });

      it("does not pause when job has no __pipelineName", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            dispatchAfterMs: 100,
            jobDataJson: JSON.stringify({ hello: "world" }),
          }),
        );
        await scripts.addPauseKey("ingestion");

        const result = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        expect(result).not.toBeNull();
        expect(result!.stagedJobId).toBe("j1");
      });

      it("different jobType is not paused", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            dispatchAfterMs: 100,
            jobDataJson: makePausedJobData(),
          }),
        );
        await scripts.addPauseKey("ingestion/reactor");

        const result = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        expect(result).not.toBeNull();
        expect(result!.stagedJobId).toBe("j1");
      });
    });

    // ADR-026: staged values are GQ1 envelopes whose routing fields live in a
    // tiny header so the Lua pause-check never decodes the (gzipped) body.
    describe("when head-of-line job is envelope-encoded", () => {
      beforeEach(() => {
        vi.stubEnv("GROUP_QUEUE_ENVELOPE_WRITES_ENABLED", "true");
      });

      afterEach(() => {
        vi.unstubAllEnvs();
      });

      async function makeEnvelopeJobData(
        overrides: Record<string, unknown> = {},
      ): Promise<string> {
        // >1 KiB so the body is gzip+base64 — proves Lua reads the header only.
        return await encodeJobEnvelope({
          jobData: {
            __pipelineName: "ingestion",
            __jobType: "projection",
            __jobName: "traceProjection",
            bulk: "x".repeat(4096),
            ...overrides,
          },
        });
      }

      it("skips group whose envelope header matches a paused pipeline", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            dispatchAfterMs: 100,
            jobDataJson: await makeEnvelopeJobData(),
          }),
        );
        await scripts.addPauseKey("ingestion");

        const result = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        expect(result).toBeNull();
      });

      it("skips group when paused at jobType level via the header", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            dispatchAfterMs: 100,
            jobDataJson: await makeEnvelopeJobData(),
          }),
        );
        await scripts.addPauseKey("ingestion/projection");

        const result = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        expect(result).toBeNull();
      });

      it("skips group when paused at jobType/jobName level via the header", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            dispatchAfterMs: 100,
            jobDataJson: await makeEnvelopeJobData(),
          }),
        );
        await scripts.addPauseKey("ingestion/projection/traceProjection");

        const result = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        expect(result).toBeNull();
      });

      it("dispatches the envelope intact when nothing is paused", async () => {
        const jobDataJson = await makeEnvelopeJobData();
        await scripts.stage(
          makeJob({ stagedJobId: "j1", dispatchAfterMs: 100, jobDataJson }),
        );

        const result = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        expect(result).not.toBeNull();
        expect(result!.jobDataJson).toBe(jobDataJson);
      });

      it("increments the per-job-name failed counter from the envelope header", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            dispatchAfterMs: 100,
            jobDataJson: await makeEnvelopeJobData(),
          }),
        );
        const dispatched = (await scripts.dispatch({
          nowMs: 200,
          activeTtlSec: 60,
        }))!;

        await scripts.restageAndBlock({
          groupId: "group-a",
          newStagedJobId: "j1/r/1",
          score: 100,
          jobDataJson: dispatched.jobDataJson,
        });

        const perJobName = await redis.get(
          `${keyPrefix()}stats:failed:traceProjection`,
        );
        expect(perJobName).toBe("1");
      });
    });

    // Tenant-level pause via "tenant:<tenantId>" entries in the same
    // paused-jobs SET. Added post-2026-05-11 incident — see
    // specs/queue-pausing/queue-pausing.feature.
    describe("when head-of-line group's tenant is paused", () => {
      function makeBenignJobData(
        overrides: Record<string, unknown> = {},
      ): string {
        return JSON.stringify({
          __pipelineName: "ingestion",
          __jobType: "projection",
          __jobName: "traceProjection",
          ...overrides,
        });
      }

      /** @scenario Pausing a tenant halts dispatch for that tenant only */
      it("parks a paused tenant's group OUT of ready (not skip-in-place) and returns null", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            groupId: "project_A/command/recordSpan/trace:xyz",
            dispatchAfterMs: 100,
            jobDataJson: makeBenignJobData(),
          }),
        );
        await scripts.addPauseKey("tenant:project_A");

        const result = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        expect(result).toBeNull();

        // The group is moved OUT of the ready scan into the tenant's parked set, so a
        // large paused backlog can never plug the bounded scan and starve other tenants.
        const ready = await inspectReadySet();
        expect(ready).not.toContain("project_A/command/recordSpan/trace:xyz");
        expect(await redis.zcard(`${keyPrefix()}parked:project_A`)).toBe(1);
        expect(
          await redis.sismember(`${keyPrefix()}parked-tenants`, "project_A"),
        ).toBe(1);
      });

      /** @scenario A paused tenant's backlog does not block other tenants */
      it("dispatches another tenant even when a paused tenant fills the front of ready", async () => {
        // Paused tenant has several due groups at the FRONT of ready (lowest scores).
        for (let i = 0; i < 5; i++) {
          await scripts.stage(
            makeJob({
              stagedJobId: `bad${i}`,
              groupId: `project_A/command/recordSpan/trace:${i}`,
              dispatchAfterMs: 100 + i,
              jobDataJson: makeBenignJobData(),
            }),
          );
        }
        // Another tenant's group is staged later (higher score = behind the paused ones).
        await scripts.stage(
          makeJob({
            stagedJobId: "good",
            groupId: "project_B/command/recordSpan/trace:b",
            dispatchAfterMs: 200,
            jobDataJson: makeBenignJobData(),
          }),
        );
        await scripts.addPauseKey("tenant:project_A");

        // Dispatch reaches project_B because project_A's groups are parked OUT of the
        // scan as it walks past them, rather than re-skipped in place every poll.
        const result = await scripts.dispatch({ nowMs: 300, activeTtlSec: 60 });
        expect(result).not.toBeNull();
        expect(result!.groupId).toBe("project_B/command/recordSpan/trace:b");

        // All 5 paused groups were moved out of ready into parked.
        expect(await redis.zcard(`${keyPrefix()}parked:project_A`)).toBe(5);
      });

      /** @scenario A still-paused tenant is not restored by the reconcile */
      it("keeps groups parked across the reconcile while the tenant stays paused", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            groupId: "project_A/command/recordSpan/trace:xyz",
            dispatchAfterMs: 100,
            jobDataJson: makeBenignJobData(),
          }),
        );
        await scripts.addPauseKey("tenant:project_A");

        // First poll parks it.
        expect(
          await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 }),
        ).toBeNull();
        expect(await redis.zcard(`${keyPrefix()}parked:project_A`)).toBe(1);

        // A later poll runs the reconcile (past the 2s gate), but the tenant is still
        // paused so unparkUpTo refuses to restore: it stays parked, dispatch null.
        expect(
          await scripts.dispatch({ nowMs: 2300, activeTtlSec: 60 }),
        ).toBeNull();
        expect(await redis.zcard(`${keyPrefix()}parked:project_A`)).toBe(1);
      });

      it("dispatches groups for non-paused tenants while paused tenant is skipped", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j-bad",
            groupId: "project_A/command/recordSpan/trace:aaa",
            dispatchAfterMs: 100,
            jobDataJson: makeBenignJobData(),
          }),
        );
        await scripts.stage(
          makeJob({
            stagedJobId: "j-ok",
            groupId: "project_B/command/recordSpan/trace:bbb",
            dispatchAfterMs: 100,
            jobDataJson: makeBenignJobData(),
          }),
        );
        await scripts.addPauseKey("tenant:project_A");

        const result = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        expect(result).not.toBeNull();
        expect(result!.groupId).toBe("project_B/command/recordSpan/trace:bbb");
        expect(result!.stagedJobId).toBe("j-ok");
      });

      /** @scenario Unpausing a tenant resumes dispatch immediately */
      it("restores the parked group and resumes dispatch after the tenant pause key is removed", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            groupId: "project_A/command/recordSpan/trace:xyz",
            dispatchAfterMs: 100,
            jobDataJson: makeBenignJobData(),
          }),
        );
        await scripts.addPauseKey("tenant:project_A");

        const blocked = await scripts.dispatch({
          nowMs: 200,
          activeTtlSec: 60,
        });
        expect(blocked).toBeNull();
        // Parked out of the ready scan while paused.
        expect(await redis.zcard(`${keyPrefix()}parked:project_A`)).toBe(1);

        await scripts.removePauseKey("tenant:project_A");

        // Unpausing restores the parked group via the dispatch reconcile (time-gated
        // ~2s): advance the clock past the gate so the next poll reconciles the
        // now-unpaused tenant back into ready and dispatches it in the same call.
        const result = await scripts.dispatch({
          nowMs: 2300,
          activeTtlSec: 60,
        });
        expect(result).not.toBeNull();
        expect(result!.stagedJobId).toBe("j1");
        expect(await redis.zcard(`${keyPrefix()}parked:project_A`)).toBe(0);
      });

      it("does not pause an unrelated tenant whose id is a prefix of the paused one", async () => {
        // SISMEMBER on the full string "tenant:project_A" must NOT match
        // a group for tenantId "project_AA". This guards against accidental
        // prefix-substring matches in the Lua extraction.
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            groupId: "project_AA/command/recordSpan/trace:xyz",
            dispatchAfterMs: 100,
            jobDataJson: makeBenignJobData(),
          }),
        );
        await scripts.addPauseKey("tenant:project_A");

        const result = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        expect(result).not.toBeNull();
        expect(result!.stagedJobId).toBe("j1");
      });

      it("tenant pause works alongside pipeline pause without interference", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            groupId: "project_A/command/recordSpan/trace:xyz",
            dispatchAfterMs: 100,
            jobDataJson: makeBenignJobData(),
          }),
        );
        // Pause BOTH the tenant AND a pipeline; the group should remain blocked
        // even if one of the pauses is later removed.
        await scripts.addPauseKey("tenant:project_A");
        await scripts.addPauseKey("ingestion");

        let result = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        expect(result).toBeNull();

        // Remove pipeline pause — tenant pause still blocks
        await scripts.removePauseKey("ingestion");
        result = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        expect(result).toBeNull();

        // Remove tenant pause — the tenant-paused group was parked out of the scan,
        // so resumption is via the dispatch reconcile (time-gated ~2s): advance the
        // clock past the gate so the next poll restores and dispatches it.
        await scripts.removePauseKey("tenant:project_A");
        result = await scripts.dispatch({ nowMs: 2300, activeTtlSec: 60 });
        expect(result).not.toBeNull();
        expect(result!.stagedJobId).toBe("j1");
      });

      it("parks a paused single-segment groupId (whole id is the tenant)", async () => {
        // Defensive: a groupId without "/" means the whole string is the tenant.
        // This shouldn't happen in production but the Lua must not error, and a
        // paused single-segment tenant must still be parked out of the scan (via
        // parkTenantOf), not left to skip-in-place.
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            groupId: "single_segment_group",
            dispatchAfterMs: 100,
            jobDataJson: makeBenignJobData(),
          }),
        );
        await scripts.addPauseKey("tenant:single_segment_group");

        const result = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        expect(result).toBeNull();
        expect(
          await redis.zcard(`${keyPrefix()}parked:single_segment_group`),
        ).toBe(1);
      });
    });
  });

  describe("dispatchBatch", () => {
    describe("when all groups have active keys", () => {
      it("exits early without scanning additional passes", async () => {
        // Stage jobs in multiple groups and dispatch them all so every group has an active key
        const groupCount = 10;
        for (let i = 0; i < groupCount; i++) {
          await scripts.stage(
            makeJob({
              stagedJobId: `j${i}`,
              groupId: `group-${i}`,
              dispatchAfterMs: 100,
            }),
          );
        }

        // Dispatch all — each group now has an active key
        const firstBatch = await scripts.dispatchBatch({
          nowMs: 200,
          activeTtlSec: 60,
          maxJobs: groupCount,
        });
        expect(firstBatch).toHaveLength(groupCount);

        // Stage more jobs in each group (they can't dispatch due to active keys)
        for (let i = 0; i < groupCount; i++) {
          await scripts.stage(
            makeJob({
              stagedJobId: `j${i}-second`,
              groupId: `group-${i}`,
              dispatchAfterMs: 100,
            }),
          );
        }

        // This dispatch should find nothing eligible and exit early
        const secondBatch = await scripts.dispatchBatch({
          nowMs: 200,
          activeTtlSec: 60,
          maxJobs: groupCount,
        });
        expect(secondBatch).toHaveLength(0);
      });
    });

    describe("when some groups become eligible after first pass dispatches", () => {
      it("does not dispatch from the same group twice in one call", async () => {
        // Stage two jobs in the same group
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            groupId: "group-a",
            dispatchAfterMs: 100,
          }),
        );
        await scripts.stage(
          makeJob({
            stagedJobId: "j2",
            groupId: "group-a",
            dispatchAfterMs: 200,
          }),
        );

        // dispatchBatch should only dispatch j1 (per-group FIFO: active key blocks j2)
        const results = await scripts.dispatchBatch({
          nowMs: 300,
          activeTtlSec: 60,
          maxJobs: 10,
        });

        expect(results).toHaveLength(1);
        expect(results[0]!.stagedJobId).toBe("j1");
      });
    });

    describe("when paused jobs exist", () => {
      it("skips paused groups and returns only non-paused", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            groupId: "group-paused",
            dispatchAfterMs: 100,
            jobDataJson: JSON.stringify({
              __pipelineName: "ingestion",
              __jobType: "projection",
              hello: "world",
            }),
          }),
        );
        await scripts.stage(
          makeJob({
            stagedJobId: "j2",
            groupId: "group-ok",
            dispatchAfterMs: 100,
            jobDataJson: JSON.stringify({ hello: "world" }),
          }),
        );
        await scripts.addPauseKey("ingestion");

        const results = await scripts.dispatchBatch({
          nowMs: 200,
          activeTtlSec: 60,
          maxJobs: 10,
        });

        expect(results).toHaveLength(1);
        expect(results[0]!.groupId).toBe("group-ok");
        expect(results[0]!.stagedJobId).toBe("j2");

        // Paused job should still be in its queue
        const jobs = await inspectGroupJobs("group-paused");
        expect(jobs).toContain("j1");
      });

      // Mirror of dispatch() tenant-pause coverage. dispatchBatch shares the
      // same pause-check Lua block but iterates multiple jobs per call, so a
      // separate test guards against the second branch drifting from the first.
      it("skips groups whose tenantId is paused and returns only other tenants", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j-bad",
            groupId: "project_A/command/recordSpan/trace:a",
            dispatchAfterMs: 100,
            jobDataJson: JSON.stringify({}),
          }),
        );
        await scripts.stage(
          makeJob({
            stagedJobId: "j-ok",
            groupId: "project_B/command/recordSpan/trace:b",
            dispatchAfterMs: 100,
            jobDataJson: JSON.stringify({}),
          }),
        );
        await scripts.addPauseKey("tenant:project_A");

        const results = await scripts.dispatchBatch({
          nowMs: 200,
          activeTtlSec: 60,
          maxJobs: 10,
        });

        expect(results).toHaveLength(1);
        expect(results[0]!.groupId).toBe(
          "project_B/command/recordSpan/trace:b",
        );
      });

      it("a non-paused tenant whose id is a prefix of a paused one still dispatches", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            groupId: "project_AA/command/recordSpan/trace:x",
            dispatchAfterMs: 100,
            jobDataJson: JSON.stringify({}),
          }),
        );
        await scripts.addPauseKey("tenant:project_A");

        const results = await scripts.dispatchBatch({
          nowMs: 200,
          activeTtlSec: 60,
          maxJobs: 10,
        });

        expect(results).toHaveLength(1);
        expect(results[0]!.stagedJobId).toBe("j1");
      });

      // Parity with specs/event-sourcing/tenant-soft-cap.feature
      // @integration @tenant-cap @batch scenarios
      describe("when tenant cap interacts with dispatchBatch", () => {
        const TENANT_CAP_ENV = "LANGWATCH_DISPATCH_TENANT_CAP";
        let originalEnv: string | undefined;

        beforeEach(() => {
          originalEnv = process.env[TENANT_CAP_ENV];
        });

        afterEach(() => {
          if (originalEnv === undefined) {
            delete process.env[TENANT_CAP_ENV];
          } else {
            process.env[TENANT_CAP_ENV] = originalEnv;
          }
        });

        /** @scenario DISPATCH_BATCH skips over-cap groups and dispatches under-cap groups in one call */
        it("over-cap tenant groups are skipped, under-cap tenant groups dispatch", async () => {
          process.env[TENANT_CAP_ENV] = "1";

          for (let i = 0; i < 5; i++) {
            await scripts.stage(
              makeJob({
                stagedJobId: `noisy-j${i}`,
                groupId: `proj_noisy/g${i}`,
                dispatchAfterMs: 1000,
              }),
            );
          }
          await scripts.stage(
            makeJob({
              stagedJobId: "quiet-j1",
              groupId: "proj_quiet/g1",
              dispatchAfterMs: 1001,
            }),
          );

          const results = await scripts.dispatchBatch({
            nowMs: 2000,
            activeTtlSec: 60,
            maxJobs: 10,
          });

          const dispatched = results.map((r) => r.groupId);
          expect(dispatched).toContain("proj_noisy/g0");
          expect(dispatched).toContain("proj_quiet/g1");
          expect(dispatched).toHaveLength(2);
        });

        /** @scenario Over-cap tenant with a blocked group does not affect other tenants */
        it("over-cap tenant blocked group is skipped without SISMEMBER affecting dispatch", async () => {
          process.env[TENANT_CAP_ENV] = "2";

          await scripts.stage(
            makeJob({
              stagedJobId: "j1",
              groupId: "proj_noisy/g1",
              dispatchAfterMs: 1000,
            }),
          );
          await scripts.stage(
            makeJob({
              stagedJobId: "j2",
              groupId: "proj_noisy/g2",
              dispatchAfterMs: 1000,
            }),
          );
          await scripts.stage(
            makeJob({
              stagedJobId: "j3",
              groupId: "proj_noisy/g3",
              dispatchAfterMs: 1000,
            }),
          );
          await scripts.stage(
            makeJob({
              stagedJobId: "quiet-j1",
              groupId: "proj_quiet/g1",
              dispatchAfterMs: 1001,
            }),
          );

          const first = await scripts.dispatchBatch({
            nowMs: 2000,
            activeTtlSec: 60,
            maxJobs: 10,
          });
          expect(first.map((r) => r.groupId)).toContain("proj_noisy/g1");
          expect(first.map((r) => r.groupId)).toContain("proj_noisy/g2");
          expect(first.map((r) => r.groupId)).not.toContain("proj_noisy/g3");
          expect(first.map((r) => r.groupId)).toContain("proj_quiet/g1");

          // restageAndBlock frees g1's slot (counter 2→1). g2 still active
          // so proj_noisy counter = 1. Complete proj_quiet/g1 so it frees
          // its slot (counter 0). Now lower cap to 1: proj_noisy (counter=1)
          // is at cap, proj_quiet (counter=0) is under cap.
          await scripts.restageAndBlock({
            groupId: "proj_noisy/g1",
            newStagedJobId: "j1-retry",
            score: 5000,
            jobDataJson: first.find((r) => r.groupId === "proj_noisy/g1")!
              .jobDataJson,
            errorMessage: "test",
          });
          await scripts.complete({
            groupId: "proj_quiet/g1",
            stagedJobId: first.find((r) => r.groupId === "proj_quiet/g1")!
              .stagedJobId,
          });
          process.env[TENANT_CAP_ENV] = "1";

          await scripts.stage(
            makeJob({
              stagedJobId: "quiet-j2",
              groupId: "proj_quiet/g2",
              dispatchAfterMs: 3001,
            }),
          );

          const second = await scripts.dispatchBatch({
            nowMs: 4000,
            activeTtlSec: 60,
            maxJobs: 10,
          });

          expect(second.map((r) => r.groupId)).not.toContain("proj_noisy/g1");
          expect(second.map((r) => r.groupId)).not.toContain("proj_noisy/g3");
          expect(second.map((r) => r.groupId)).toContain("proj_quiet/g2");
        });

        /** @scenario Drift cleanup runs for under-cap tenants in batch dispatch */
        it("drift cleanup still runs for under-cap tenants with empty job ZSETs", async () => {
          process.env[TENANT_CAP_ENV] = "10";

          await scripts.stage(
            makeJob({
              stagedJobId: "j1",
              groupId: "proj_acme/g1",
              dispatchAfterMs: 1000,
            }),
          );

          const batch1 = await scripts.dispatchBatch({
            nowMs: 2000,
            activeTtlSec: 60,
            maxJobs: 10,
          });
          expect(batch1).toHaveLength(1);

          await scripts.complete({
            groupId: "proj_acme/g1",
            stagedJobId: batch1[0]!.stagedJobId,
          });

          await redis.zadd(`${keyPrefix()}ready`, 2500, "proj_acme/g-zombie");
          const readyBefore = await inspectReadySet();
          expect(readyBefore).toContain("proj_acme/g-zombie");

          await scripts.dispatchBatch({
            nowMs: 3000,
            activeTtlSec: 60,
            maxJobs: 10,
          });

          const readyAfter = await inspectReadySet();
          expect(readyAfter).not.toContain("proj_acme/g-zombie");
        });
      });
    });
  });

  // ============================================================================
  // Counter conservation: the total-pending counter must remain consistent
  // across every lifecycle path. These tests pin the invariant and document
  // known drift scenarios. Post-2026-05-21 Redis saturation incident.
  // ============================================================================
  describe("counter conservation", () => {
    async function inspectTotalPending(): Promise<number> {
      const val = await redis.get(`${keyPrefix()}stats:total-pending`);
      return Number(val) || 0;
    }

    let repo: QueueRedisRepository;
    beforeAll(() => {
      repo = new QueueRedisRepository(redis);
    });

    describe("when the happy path completes normally", () => {
      /** @scenario Counter tracks jobs in :jobs ZSETs through happy path */
      it("total-pending returns to 0 after stage → dispatch → complete", async () => {
        await scripts.stage(
          makeJob({ stagedJobId: "j1", groupId: "g1", dispatchAfterMs: 100 }),
        );
        await scripts.stage(
          makeJob({ stagedJobId: "j2", groupId: "g2", dispatchAfterMs: 100 }),
        );
        await scripts.stage(
          makeJob({ stagedJobId: "j3", groupId: "g3", dispatchAfterMs: 100 }),
        );

        expect(await inspectTotalPending()).toBe(3);

        const d1 = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        const d2 = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        const d3 = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });

        await scripts.complete({
          groupId: d1!.groupId,
          stagedJobId: d1!.stagedJobId,
        });
        await scripts.complete({
          groupId: d2!.groupId,
          stagedJobId: d2!.stagedJobId,
        });
        await scripts.complete({
          groupId: d3!.groupId,
          stagedJobId: d3!.stagedJobId,
        });

        expect(await inspectTotalPending()).toBe(0);
      });
    });

    describe("when active key expires before COMPLETE", () => {
      /** @scenario Counter stays accurate when activeKey expires before COMPLETE */
      it("counter stays accurate — DECR happened at dispatch, not complete", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            groupId: "g-leak",
            dispatchAfterMs: 100,
          }),
        );
        expect(await inspectTotalPending()).toBe(1);

        await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        // DECR happened at dispatch time (ZREM from :jobs). Counter is now 0.
        expect(await inspectTotalPending()).toBe(0);

        // Simulate active key expiry (Redis TTL fires or saturation delays heartbeat)
        await redis.del(`${keyPrefix()}group:g-leak:active`);

        const completed = await scripts.complete({
          groupId: "g-leak",
          stagedJobId: "j1",
        });
        expect(completed).toBe(false);

        // FIX: counter is 0 — DECR already happened at dispatch time.
        // COMPLETE_LUA no longer touches the counter, so active key
        // expiry can't cause drift. This was the root cause of the
        // 826K phantom counter in production.
        expect(await inspectTotalPending()).toBe(0);
      });
    });

    describe("when a job is retried via retryRestage", () => {
      /** @scenario Counter tracks retry restage as a new pending job */
      it("total-pending returns to 0 after stage → dispatch → retryRestage → dispatch → complete", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            groupId: "g-retry",
            dispatchAfterMs: 100,
          }),
        );
        expect(await inspectTotalPending()).toBe(1);

        const d1 = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        expect(d1).not.toBeNull();

        // Worker fails, re-stages with backoff
        const restaged = await scripts.retryRestage({
          groupId: "g-retry",
          stagedJobId: "j1",
          newStagedJobId: "j1/r/1",
          dispatchAfterMs: 300,
          jobDataJson: JSON.stringify({ attempt: 2 }),
          backoffMs: 1000,
        });
        expect(restaged).toBe(true);

        // Active key expires after the short backoff TTL
        await redis.del(`${keyPrefix()}group:g-retry:active`);

        // Dispatch the retry job
        const d2 = await scripts.dispatch({ nowMs: 400, activeTtlSec: 60 });
        expect(d2).not.toBeNull();
        expect(d2!.stagedJobId).toBe("j1/r/1");

        // Retry succeeds
        await scripts.complete({ groupId: "g-retry", stagedJobId: "j1/r/1" });

        expect(await inspectTotalPending()).toBe(0);
      });
    });

    describe("when a job exhausts retries via restageAndBlock", () => {
      /** @scenario Counter tracks restage-and-block as a new pending job */
      it("total-pending returns to 0 after stage → dispatch → restageAndBlock → unblock → dispatch → complete", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            groupId: "g-block",
            dispatchAfterMs: 100,
          }),
        );
        expect(await inspectTotalPending()).toBe(1);

        const d1 = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        expect(d1).not.toBeNull();

        // Worker exhausts retries — block the group and re-stage
        await scripts.restageAndBlock({
          groupId: "g-block",
          newStagedJobId: "j1/r/final",
          score: 100,
          jobDataJson: JSON.stringify({ exhausted: true }),
          errorMessage: "Max retries exceeded",
        });

        expect(await inspectTotalPending()).toBe(1);

        // Operator unblocks the group via UNBLOCK_LUA
        const { wasBlocked } = await repo.unblockGroup({
          queueName: QUEUE_NAME,
          groupId: "g-block",
        });
        expect(wasBlocked).toBe(true);

        // Dispatch the restaged job
        const d2 = await scripts.dispatch({ nowMs: 300, activeTtlSec: 60 });
        expect(d2).not.toBeNull();
        expect(d2!.stagedJobId).toBe("j1/r/final");

        // Job succeeds this time
        await scripts.complete({
          groupId: "g-block",
          stagedJobId: "j1/r/final",
        });

        expect(await inspectTotalPending()).toBe(0);
      });
    });

    describe("when a job is retried multiple times before succeeding", () => {
      it("total-pending returns to 0 after 3 retries then success", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            groupId: "g-multi",
            dispatchAfterMs: 100,
          }),
        );
        expect(await inspectTotalPending()).toBe(1);

        // Attempt 1: dispatch → fail → retryRestage
        await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        await scripts.retryRestage({
          groupId: "g-multi",
          stagedJobId: "j1",
          newStagedJobId: "j1/r/1",
          dispatchAfterMs: 300,
          jobDataJson: JSON.stringify({ attempt: 2 }),
          backoffMs: 500,
        });
        await redis.del(`${keyPrefix()}group:g-multi:active`);

        // Attempt 2: dispatch → fail → retryRestage
        const d2 = await scripts.dispatch({ nowMs: 400, activeTtlSec: 60 });
        expect(d2!.stagedJobId).toBe("j1/r/1");
        await scripts.retryRestage({
          groupId: "g-multi",
          stagedJobId: "j1/r/1",
          newStagedJobId: "j1/r/2",
          dispatchAfterMs: 500,
          jobDataJson: JSON.stringify({ attempt: 3 }),
          backoffMs: 1000,
        });
        await redis.del(`${keyPrefix()}group:g-multi:active`);

        // Attempt 3: dispatch → fail → retryRestage
        const d3 = await scripts.dispatch({ nowMs: 600, activeTtlSec: 60 });
        expect(d3!.stagedJobId).toBe("j1/r/2");
        await scripts.retryRestage({
          groupId: "g-multi",
          stagedJobId: "j1/r/2",
          newStagedJobId: "j1/r/3",
          dispatchAfterMs: 700,
          jobDataJson: JSON.stringify({ attempt: 4 }),
          backoffMs: 2000,
        });
        await redis.del(`${keyPrefix()}group:g-multi:active`);

        // Attempt 4: dispatch → success
        const d4 = await scripts.dispatch({ nowMs: 800, activeTtlSec: 60 });
        expect(d4!.stagedJobId).toBe("j1/r/3");
        await scripts.complete({ groupId: "g-multi", stagedJobId: "j1/r/3" });

        expect(await inspectTotalPending()).toBe(0);
      });
    });

    describe("4-script fix validation (DECR at dispatch + compensating INCRs)", () => {
      it("dispatch→retry→dispatch cycle stays balanced with real scripts", async () => {
        // Previously this test simulated the NAIVE 2-script fix manually
        // to prove it was incomplete (negative drift). Now the real scripts
        // implement the full 4-script fix: DECR at dispatch + INCR at
        // retryRestage/restageAndBlock. No manual counter manipulation needed.

        // Stage: INCR → counter = 1
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            groupId: "g-balanced",
            dispatchAfterMs: 100,
          }),
        );
        expect(await inspectTotalPending()).toBe(1);

        // Dispatch: DECR at ZREM → counter = 0
        await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        expect(await inspectTotalPending()).toBe(0);

        // retryRestage: INCR (job re-enters :jobs) → counter = 1
        await scripts.retryRestage({
          groupId: "g-balanced",
          stagedJobId: "j1",
          newStagedJobId: "j1/r/1",
          dispatchAfterMs: 300,
          jobDataJson: JSON.stringify({ attempt: 2 }),
          backoffMs: 500,
        });
        expect(await inspectTotalPending()).toBe(1);

        // Active key expires, dispatch retry: DECR → counter = 0
        await redis.del(`${keyPrefix()}group:g-balanced:active`);
        await scripts.dispatch({ nowMs: 400, activeTtlSec: 60 });
        expect(await inspectTotalPending()).toBe(0);

        // Complete: no counter change → counter = 0
        await scripts.complete({
          groupId: "g-balanced",
          stagedJobId: "j1/r/1",
        });
        expect(await inspectTotalPending()).toBe(0);
      });
    });

    describe("counter reconciliation invariant", () => {
      /** @scenario Counter equals sum of all :jobs ZSET cardinalities */
      it("total-pending equals sum of ZCARD(:jobs) across all groups", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "a1",
            groupId: "g-recon-a",
            dispatchAfterMs: 100,
          }),
        );
        await scripts.stage(
          makeJob({
            stagedJobId: "a2",
            groupId: "g-recon-a",
            dispatchAfterMs: 200,
          }),
        );
        await scripts.stage(
          makeJob({
            stagedJobId: "b1",
            groupId: "g-recon-b",
            dispatchAfterMs: 100,
          }),
        );
        await scripts.stage(
          makeJob({
            stagedJobId: "c1",
            groupId: "g-recon-c",
            dispatchAfterMs: 100,
          }),
        );
        await scripts.stage(
          makeJob({
            stagedJobId: "c2",
            groupId: "g-recon-c",
            dispatchAfterMs: 200,
          }),
        );

        // Dispatch some — creates mixed state (some staged, some active)
        await scripts.dispatch({ nowMs: 300, activeTtlSec: 60 });
        await scripts.dispatch({ nowMs: 300, activeTtlSec: 60 });

        // Reconcile: counter should equal jobs in :jobs ZSETs only.
        // Active (in-flight) jobs were already DECRed at dispatch time.
        const groups = ["g-recon-a", "g-recon-b", "g-recon-c"];
        let actualPending = 0;
        for (const g of groups) {
          const jobCount = await redis.zcard(`${keyPrefix()}group:${g}:jobs`);
          actualPending += jobCount;
        }

        expect(await inspectTotalPending()).toBe(actualPending);
      });

      it("retryRestage preserves the invariant — retry INCRs when job re-enters :jobs", async () => {
        await scripts.stage(
          makeJob({
            stagedJobId: "j1",
            groupId: "g-recon-retry",
            dispatchAfterMs: 100,
          }),
        );
        expect(await inspectTotalPending()).toBe(1);

        // Dispatch: DECR → counter = 0
        await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        expect(await inspectTotalPending()).toBe(0);

        // retryRestage: INCR → counter = 1
        await scripts.retryRestage({
          groupId: "g-recon-retry",
          stagedJobId: "j1",
          newStagedJobId: "j1/r/1",
          dispatchAfterMs: 300,
          jobDataJson: JSON.stringify({ attempt: 2 }),
          backoffMs: 500,
        });

        // retryRestage ZADD'd a new job AND INCR'd the counter.
        // ZCARD(:jobs) = 1 (retry job), counter = 1. Invariant holds.
        const jobCount = await redis.zcard(
          `${keyPrefix()}group:g-recon-retry:jobs`,
        );
        expect(jobCount).toBe(1);
        expect(await inspectTotalPending()).toBe(1);
        expect(await inspectTotalPending()).toBe(jobCount);
      });
    });
  });

  // ============================================================================
  // DRAIN_GROUP_LUA (lives in queue.redis.repository.ts but consumes the same
  // group keys and stats:total-pending counter that the scripts in this suite
  // produce, so it belongs here). Post-2026-05-11 incident: drain MUST
  // decrement total-pending or bulk-drain at 500K scale leaks the stat.
  // ============================================================================
  describe("DRAIN_GROUP_LUA total-pending decrement", () => {
    let repo: QueueRedisRepository;
    beforeAll(() => {
      repo = new QueueRedisRepository(redis);
    });

    /** @scenario drainTenant decrements stats:total-pending atomically per group */
    it("decrements stats:total-pending by the count of staged jobs dropped", async () => {
      await scripts.stage(
        makeJob({
          stagedJobId: "j1",
          groupId: "g-drain",
          dispatchAfterMs: 1000,
        }),
      );
      await scripts.stage(
        makeJob({
          stagedJobId: "j2",
          groupId: "g-drain",
          dispatchAfterMs: 2000,
        }),
      );
      await scripts.stage(
        makeJob({
          stagedJobId: "j3",
          groupId: "g-drain",
          dispatchAfterMs: 3000,
        }),
      );

      const before = Number(
        await redis.get(`${keyPrefix()}stats:total-pending`),
      );
      expect(before).toBe(3);

      const result = await repo.drainGroup({
        queueName: QUEUE_NAME,
        groupId: "g-drain",
      });
      expect(result.jobsRemoved).toBe(3);

      const after = Number(
        await redis.get(`${keyPrefix()}stats:total-pending`),
      );
      expect(after).toBe(0);
    });

    it("decrements only staged jobs — active job was already DECRed at dispatch", async () => {
      // Stage two, dispatch one (now active), then drain. Total dropped
      // should be 1 (just j2 in :jobs). j1's INCR was already compensated
      // by DECR at dispatch time. Drain must NOT count the active job
      // again or the counter goes negative.
      await scripts.stage(
        makeJob({
          stagedJobId: "j1",
          groupId: "g-active",
          dispatchAfterMs: 100,
        }),
      );
      await scripts.stage(
        makeJob({
          stagedJobId: "j2",
          groupId: "g-active",
          dispatchAfterMs: 200,
        }),
      );

      const afterStage = Number(
        await redis.get(`${keyPrefix()}stats:total-pending`),
      );
      expect(afterStage).toBe(2);

      // Move j1 from staged → active (DECR at dispatch → counter = 1)
      const dispatched = await scripts.dispatch({
        nowMs: 150,
        activeTtlSec: 60,
      });
      expect(dispatched).not.toBeNull();
      expect(dispatched!.stagedJobId).toBe("j1");
      expect(await inspectActiveKey("g-active")).toBe("j1");

      const afterDispatch = Number(
        await redis.get(`${keyPrefix()}stats:total-pending`),
      );
      expect(afterDispatch).toBe(1); // j2 still in :jobs

      const result = await repo.drainGroup({
        queueName: QUEUE_NAME,
        groupId: "g-active",
      });
      expect(result.jobsRemoved).toBe(1); // only j2 (staged), not j1 (active)

      const after = Number(
        await redis.get(`${keyPrefix()}stats:total-pending`),
      );
      expect(after).toBe(0);
    });

    it("drain on a fully-dispatched group drops 0 jobs", async () => {
      // Edge case: ZCARD=0 because the only job was dispatched (DECRed).
      // activeKey exists but drain must NOT count it — already DECRed.
      await scripts.stage(
        makeJob({
          stagedJobId: "j1",
          groupId: "g-only-active",
          dispatchAfterMs: 100,
        }),
      );
      await scripts.dispatch({ nowMs: 150, activeTtlSec: 60 });
      expect(await inspectActiveKey("g-only-active")).toBe("j1");

      const before = Number(
        await redis.get(`${keyPrefix()}stats:total-pending`),
      );
      expect(before).toBe(0); // dispatch already DECRed

      const result = await repo.drainGroup({
        queueName: QUEUE_NAME,
        groupId: "g-only-active",
      });
      expect(result.jobsRemoved).toBe(0); // no staged jobs to drop

      const after = Number(
        await redis.get(`${keyPrefix()}stats:total-pending`),
      );
      expect(after).toBe(0);
    });

    it("returns 0 and does not touch total-pending when the group is empty", async () => {
      // Defensive: drain on a never-existed group should not push counter negative.
      await redis.set(`${keyPrefix()}stats:total-pending`, "5");

      const result = await repo.drainGroup({
        queueName: QUEUE_NAME,
        groupId: "never-existed",
      });
      expect(result.jobsRemoved).toBe(0);

      const after = Number(
        await redis.get(`${keyPrefix()}stats:total-pending`),
      );
      expect(after).toBe(5);
    });
  });

  describe("drainTenant bulk scoping", () => {
    let repo: QueueRedisRepository;
    beforeAll(() => {
      repo = new QueueRedisRepository(redis);
    });

    /** @scenario drainTenant supports an optional groupIdContains substring filter */
    it("with groupIdContains filter, drains only matching groupIds within the tenant", async () => {
      // Stage groups across two projections for the same tenant + one group
      // for a different tenant. Filter should hit only fold/projectDailySdkUsage.
      await scripts.stage(
        makeJob({
          stagedJobId: "fold-a",
          groupId: "project_X/fold/projectDailySdkUsage/key-1",
          dispatchAfterMs: 100,
          jobDataJson: JSON.stringify({}),
        }),
      );
      await scripts.stage(
        makeJob({
          stagedJobId: "fold-b",
          groupId: "project_X/fold/projectDailySdkUsage/key-2",
          dispatchAfterMs: 100,
          jobDataJson: JSON.stringify({}),
        }),
      );
      await scripts.stage(
        makeJob({
          stagedJobId: "cmd-c",
          groupId: "project_X/command/recordSpan/trace:t1",
          dispatchAfterMs: 100,
          jobDataJson: JSON.stringify({}),
        }),
      );
      await scripts.stage(
        makeJob({
          stagedJobId: "other-tenant",
          groupId: "project_Y/fold/projectDailySdkUsage/key-1",
          dispatchAfterMs: 100,
          jobDataJson: JSON.stringify({}),
        }),
      );

      const result = await repo.drainTenant({
        queueName: QUEUE_NAME,
        tenantId: "project_X",
        groupIdContains: "/fold/projectDailySdkUsage/",
      });

      expect(result.groupsDrained).toBe(2); // only the two fold groups for project_X
      expect(result.jobsDrained).toBe(2);

      // Untouched groups still hold their jobs
      const cmdJobs = await inspectGroupJobs(
        "project_X/command/recordSpan/trace:t1",
      );
      expect(cmdJobs.filter((s) => !s.match(/^\d+$/))).toContain("cmd-c");
      const otherTenantJobs = await inspectGroupJobs(
        "project_Y/fold/projectDailySdkUsage/key-1",
      );
      expect(otherTenantJobs.filter((s) => !s.match(/^\d+$/))).toContain(
        "other-tenant",
      );
    });

    it("without groupIdContains, drains every group for the tenant", async () => {
      await scripts.stage(
        makeJob({
          stagedJobId: "a",
          groupId: "project_All/fold/x/key-1",
          dispatchAfterMs: 100,
          jobDataJson: JSON.stringify({}),
        }),
      );
      await scripts.stage(
        makeJob({
          stagedJobId: "b",
          groupId: "project_All/map/y/key-1",
          dispatchAfterMs: 100,
          jobDataJson: JSON.stringify({}),
        }),
      );

      const result = await repo.drainTenant({
        queueName: QUEUE_NAME,
        tenantId: "project_All",
      });

      expect(result.groupsDrained).toBe(2);
      expect(result.jobsDrained).toBe(2);
    });

    it("ignores groupIds that match the filter but belong to a different tenant", async () => {
      await scripts.stage(
        makeJob({
          stagedJobId: "wrong-tenant",
          groupId: "project_Z/fold/somethingShared/key-1",
          dispatchAfterMs: 100,
          jobDataJson: JSON.stringify({}),
        }),
      );

      const result = await repo.drainTenant({
        queueName: QUEUE_NAME,
        tenantId: "project_NotZ",
        groupIdContains: "/fold/somethingShared/",
      });

      expect(result.groupsDrained).toBe(0);
      expect(result.jobsDrained).toBe(0);

      const survivors = await inspectGroupJobs(
        "project_Z/fold/somethingShared/key-1",
      );
      expect(survivors.filter((s) => !s.match(/^\d+$/))).toContain(
        "wrong-tenant",
      );
    });
  });

  /**
   * Tenant soft-cap integration coverage.
   *
   * These tests drive the Lua paths against a real Redis (via
   * testcontainers) and prove:
   *   - the per-tenant in-flight ZSET `tenant_active_z:<tenantId>` stays
   *     consistent across DISPATCH (ZADD), COMPLETE / RESTAGE_AND_BLOCK (ZREM)
   *     and REFRESH / RETRY_RESTAGE (score renewal)
   *   - a slot whose worker dies ungracefully lapses out of the live count once
   *     its expiry score falls into the past, so the cap self-heals with no
   *     operator reset
   *   - cap enforcement at the scheduler level
   *   - widened scan budget keeps cross-tenant fairness when an
   *     over-cap tenant dominates the head of the ready zset
   *   - cap=0 (kill switch) leaves the ZSET machinery completely
   *     inert: no `tenant_active_z:*` keys ever appear
   *
   * All scenarios mutate `LANGWATCH_DISPATCH_TENANT_CAP` per test
   * (readTenantCap reads process.env at call time on purpose) and
   * restore it in afterEach so test ordering is independent.
   */
  describe("tenant soft-cap (LANGWATCH_DISPATCH_TENANT_CAP)", () => {
    const TENANT_CAP_ENV = "LANGWATCH_DISPATCH_TENANT_CAP";
    let originalEnv: string | undefined;

    beforeEach(() => {
      originalEnv = process.env[TENANT_CAP_ENV];
    });

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env[TENANT_CAP_ENV];
      } else {
        process.env[TENANT_CAP_ENV] = originalEnv;
      }
    });

    function tenantActiveZKey(tenantId: string) {
      return `${keyPrefix()}tenant_active_z:${tenantId}`;
    }

    // Live in-flight count for a tenant = ZSET members whose expiry score is
    // strictly in the future (> nowMs); a slot at-or-past nowMs has lapsed.
    async function tenantLiveCount(tenantId: string, nowMs: number) {
      // Exclusive lower bound mirrors the Lua live-count contract: the script
      // GCs scores at-or-below nowMs (ZREMRANGEBYSCORE "-inf" nowMs) then ZCARDs,
      // so a slot scored exactly nowMs has lapsed and is not counted.
      return redis.zcount(tenantActiveZKey(tenantId), `(${nowMs}`, "+inf");
    }

    async function stageOne({
      tenantId,
      groupSuffix,
      stagedJobId,
      dispatchAfterMs = 1000,
    }: {
      tenantId: string;
      groupSuffix: string;
      stagedJobId: string;
      dispatchAfterMs?: number;
    }) {
      const groupId = `${tenantId}/${groupSuffix}`;
      await scripts.stage(makeJob({ groupId, stagedJobId, dispatchAfterMs }));
      return groupId;
    }

    /** @scenario An in-flight slot is added on dispatch and removed on completion */
    it("adds the group to the tenant ZSET on dispatch and removes it on completion", async () => {
      process.env[TENANT_CAP_ENV] = "10";
      const groupId = await stageOne({
        tenantId: "proj_acme",
        groupSuffix: "g1",
        stagedJobId: "j1",
      });

      const dispatched = await scripts.dispatch({
        nowMs: 2000,
        activeTtlSec: 60,
      });
      expect(dispatched?.groupId).toBe(groupId);

      // One live slot after first dispatch, scored at the slot's expiry
      // (nowMs + activeTtlSec*1000 = 2000 + 60000 = 62000).
      expect(await redis.zcard(tenantActiveZKey("proj_acme"))).toBe(1);
      expect(await redis.zscore(tenantActiveZKey("proj_acme"), groupId)).toBe(
        "62000",
      );

      // Live-count boundary: a slot is live only while strictly in the future
      // (score > nowMs). One ms before its 62000 expiry it counts; AT exactly
      // 62000 it has lapsed and does not (mirrors the activeKey vanishing at TTL).
      expect(await tenantLiveCount("proj_acme", 61999)).toBe(1);
      expect(await tenantLiveCount("proj_acme", 62000)).toBe(0);

      // Completing the only in-flight group removes its slot, leaving the ZSET
      // empty (Redis drops a ZSET key once its last member is removed).
      await scripts.complete({
        groupId,
        stagedJobId: dispatched!.stagedJobId,
      });
      expect(await redis.zcard(tenantActiveZKey("proj_acme"))).toBe(0);
      expect(await redis.exists(tenantActiveZKey("proj_acme"))).toBe(0);
    });

    it("removes only the completed group's slot when other groups are in flight for the same tenant", async () => {
      process.env[TENANT_CAP_ENV] = "10";
      await stageOne({
        tenantId: "proj_acme",
        groupSuffix: "g1",
        stagedJobId: "j1",
      });
      await stageOne({
        tenantId: "proj_acme",
        groupSuffix: "g2",
        stagedJobId: "j2",
      });

      // Dispatch with a real wall-clock nowMs so the in-flight slot scores
      // (nowMs + activeTtlSec*1000) are genuinely in the future when COMPLETE
      // runs its lapsed-slot GC against Date.now(). A synthetic small nowMs
      // would make every slot look already-expired and get GC'd at completion.
      const now = Date.now();
      const d1 = await scripts.dispatch({ nowMs: now, activeTtlSec: 60 });
      const d2 = await scripts.dispatch({ nowMs: now, activeTtlSec: 60 });
      expect(d1).not.toBeNull();
      expect(d2).not.toBeNull();
      expect(await redis.zcard(tenantActiveZKey("proj_acme"))).toBe(2);

      // Complete only one
      await scripts.complete({
        groupId: d1!.groupId,
        stagedJobId: d1!.stagedJobId,
      });
      expect(await redis.zcard(tenantActiveZKey("proj_acme"))).toBe(1);
      // The remaining slot belongs to the still-active group.
      expect(
        await redis.zscore(tenantActiveZKey("proj_acme"), d2!.groupId),
      ).not.toBeNull();
      expect(
        await redis.zscore(tenantActiveZKey("proj_acme"), d1!.groupId),
      ).toBeNull();
    });

    /** @scenario RESTAGE_AND_BLOCK removes the in-flight slot on exhausted retries */
    it("RESTAGE_AND_BLOCK_LUA removes the tenant slot (preventing slot leak on terminal failures)", async () => {
      process.env[TENANT_CAP_ENV] = "10";
      const groupId = await stageOne({
        tenantId: "proj_acme",
        groupSuffix: "g1",
        stagedJobId: "j1",
      });
      await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 });
      expect(await redis.zcard(tenantActiveZKey("proj_acme"))).toBe(1);

      await scripts.restageAndBlock({
        groupId,
        newStagedJobId: "j1-restaged",
        score: 9999,
        jobDataJson: JSON.stringify({ hello: "world" }),
        errorMessage: "max retries",
      });
      expect(await redis.zcard(tenantActiveZKey("proj_acme"))).toBe(0);
    });

    /** @scenario REFRESH bumps the in-flight slot expiry in lockstep with activeKey */
    it("REFRESH_LUA bumps the tenant slot's expiry score in lockstep with activeKey", async () => {
      process.env[TENANT_CAP_ENV] = "10";
      const groupId = await stageOne({
        tenantId: "proj_acme",
        groupSuffix: "g1",
        stagedJobId: "j1",
      });
      const dispatched = await scripts.dispatch({
        nowMs: 2000,
        activeTtlSec: 60,
      });

      // Initial slot score = dispatch nowMs (2000) + 60000 = 62000.
      expect(await redis.zscore(tenantActiveZKey("proj_acme"), groupId)).toBe(
        "62000",
      );

      // refreshActiveKey uses Date.now() internally, so the bumped score is a
      // real wall-clock expiry far past the initial 62000 placeholder.
      await scripts.refreshActiveKey({
        groupId,
        stagedJobId: dispatched!.stagedJobId,
        activeTtlSec: 60,
      });

      const score = Number(
        await redis.zscore(tenantActiveZKey("proj_acme"), groupId),
      );
      const expectedExpiry = Date.now() + 60 * 1000;
      expect(score).toBeGreaterThan(62000);
      // Slot expiry tracks the activeKey heartbeat (Date.now() + ttl), within a
      // generous skew for test execution time.
      expect(Math.abs(score - expectedExpiry)).toBeLessThanOrEqual(2000);
    });

    it("REFRESH_LUA does not re-create a slot that was already freed (XX semantics)", async () => {
      process.env[TENANT_CAP_ENV] = "10";
      const groupId = await stageOne({
        tenantId: "proj_acme",
        groupSuffix: "g1",
        stagedJobId: "j1",
      });
      const dispatched = await scripts.dispatch({
        nowMs: 2000,
        activeTtlSec: 60,
      });

      // Free the slot out from under an in-flight heartbeat (as COMPLETE would).
      await redis.zrem(tenantActiveZKey("proj_acme"), groupId);

      // A racing refresh must NOT re-insert the freed slot (ZADD XX).
      await scripts.refreshActiveKey({
        groupId,
        stagedJobId: dispatched!.stagedJobId,
        activeTtlSec: 60,
      });
      expect(
        await redis.zscore(tenantActiveZKey("proj_acme"), groupId),
      ).toBeNull();
    });

    /** @scenario RETRY_RESTAGE bumps the in-flight slot expiry to the retry window */
    it("RETRY_RESTAGE_LUA bumps the tenant slot's expiry score to the retry window", async () => {
      process.env[TENANT_CAP_ENV] = "10";
      const groupId = await stageOne({
        tenantId: "proj_acme",
        groupSuffix: "g1",
        stagedJobId: "j1",
      });
      const dispatched = await scripts.dispatch({
        nowMs: 2000,
        activeTtlSec: 60,
      });

      await scripts.retryRestage({
        groupId,
        stagedJobId: dispatched!.stagedJobId,
        newStagedJobId: "j1-retry",
        dispatchAfterMs: 9999,
        jobDataJson: JSON.stringify({ hello: "world" }),
        backoffMs: 30_000,
      });

      // retryRestage sets the slot expiry to Date.now() + retryTtlSec*1000,
      // retryTtlSec = ceil(backoffMs/1000)+2 = 32s.
      const score = Number(
        await redis.zscore(tenantActiveZKey("proj_acme"), groupId),
      );
      const expectedExpiry = Date.now() + 32 * 1000;
      expect(score).toBeGreaterThan(0);
      expect(Math.abs(score - expectedExpiry)).toBeLessThanOrEqual(2000);
    });

    /** @scenario DISPATCH_LUA refuses to dispatch when tenant is at cap */
    it("refuses to dispatch a group whose tenant is already at cap", async () => {
      process.env[TENANT_CAP_ENV] = "2";
      // Three groups, all same tenant, all eligible
      await stageOne({
        tenantId: "proj_noisy",
        groupSuffix: "g1",
        stagedJobId: "j1",
      });
      await stageOne({
        tenantId: "proj_noisy",
        groupSuffix: "g2",
        stagedJobId: "j2",
      });
      await stageOne({
        tenantId: "proj_noisy",
        groupSuffix: "g3",
        stagedJobId: "j3",
      });

      // First two dispatches OK
      expect(
        await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 }),
      ).not.toBeNull();
      expect(
        await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 }),
      ).not.toBeNull();
      expect(await redis.zcard(tenantActiveZKey("proj_noisy"))).toBe(2);

      // Third dispatch must be refused: tenant is at cap=2
      const third = await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 });
      expect(third).toBeNull();
      // Live count unchanged: over-cap groups don't add a slot
      expect(await redis.zcard(tenantActiveZKey("proj_noisy"))).toBe(2);
      // g3 was parked OUT of the ready scan (not left at the head to be
      // re-walked on every poll) and registered for reconcile.
      const ready = await inspectReadySet();
      expect(ready.some((s) => s === "proj_noisy/g3")).toBe(false);
      expect(await redis.zcard(`${keyPrefix()}parked:proj_noisy`)).toBe(1);
      expect(
        await redis.sismember(`${keyPrefix()}parked-tenants`, "proj_noisy"),
      ).toBe(1);
    });

    /** @scenario Over-cap tenant at the head of the zset does not starve other tenants */
    it("widened scan budget walks past over-cap tenant's groups to serve a quiet tenant deeper in the zset", async () => {
      process.env[TENANT_CAP_ENV] = "1";

      // proj_noisy stages 50 groups at score=1000 (head of zset)
      const noisyJobs = Array.from({ length: 50 }, (_, i) =>
        makeJob({
          groupId: `proj_noisy/g${i}`,
          stagedJobId: `noisy-j${i}`,
          dispatchAfterMs: 1000,
        }),
      );
      await scripts.stageBatch(noisyJobs);

      // proj_quiet stages 1 group at score=1001 (later in zset)
      await stageOne({
        tenantId: "proj_quiet",
        groupSuffix: "only",
        stagedJobId: "quiet-j1",
        dispatchAfterMs: 1001,
      });

      // First dispatch: proj_noisy/g0 wins (live count goes 0->1)
      const first = await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 });
      expect(first?.groupId).toMatch(/^proj_noisy\//);
      expect(await redis.zcard(tenantActiveZKey("proj_noisy"))).toBe(1);

      // Second dispatch: proj_noisy is at cap, scheduler MUST walk past
      // its remaining 49 over-cap groups and find proj_quiet's one group.
      const second = await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 });
      expect(second).not.toBeNull();
      expect(second!.groupId).toBe("proj_quiet/only");
      expect(await redis.zcard(tenantActiveZKey("proj_quiet"))).toBe(1);
    });

    /** @scenario Over-cap groups are parked out of ready so they don't starve other tenants on repeated polls */
    it("parks over-cap groups out of ready so the next dispatch reaches other tenants immediately", async () => {
      process.env[TENANT_CAP_ENV] = "1";

      // proj_noisy stages 50 groups at score=1000 (head of zset)
      const noisyJobs = Array.from({ length: 50 }, (_, i) =>
        makeJob({
          groupId: `proj_noisy/g${i}`,
          stagedJobId: `noisy-j${i}`,
          dispatchAfterMs: 1000,
        }),
      );
      await scripts.stageBatch(noisyJobs);

      // proj_quiet stages 1 group at score=1001 (later in zset)
      await stageOne({
        tenantId: "proj_quiet",
        groupSuffix: "only",
        stagedJobId: "quiet-j1",
        dispatchAfterMs: 1001,
      });

      // First dispatch: proj_noisy/g0 wins (under cap)
      const first = await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 });
      expect(first?.groupId).toMatch(/^proj_noisy\//);

      // Second dispatch: proj_noisy is now at cap, so its remaining groups are
      // parked OUT of ready as the scan walks past them, and proj_quiet wins.
      const second = await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 });
      expect(second!.groupId).toBe("proj_quiet/only");

      // Key assertion: the over-cap noisy groups are no longer in the ready
      // scan (parked), so a third poll at the same nowMs returns null without
      // re-walking them — write volume no longer scales with backlog size.
      const third = await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 });
      expect(third).toBeNull();

      // The 49 remaining noisy groups were moved OUT of ready into the parked
      // set, and the tenant is registered so the reconcile can find it.
      expect(await redis.zcard(`${keyPrefix()}parked:proj_noisy`)).toBe(49);
      expect(
        await redis.sismember(`${keyPrefix()}parked-tenants`, "proj_noisy"),
      ).toBe(1);
      // Ready now holds only the two active groups (g0 + quiet), both at future
      // active scores — nothing is due, the parked backlog isn't re-scanned.
      expect(await redis.zcount(`${keyPrefix()}ready`, "-inf", "2000")).toBe(0);
    });

    /** @scenario dispatchBatch parks over-cap groups the same way */
    it("dispatchBatch parks over-cap groups out of ready", async () => {
      process.env[TENANT_CAP_ENV] = "1";

      const noisyJobs = Array.from({ length: 20 }, (_, i) =>
        makeJob({
          groupId: `proj_noisy/g${i}`,
          stagedJobId: `noisy-j${i}`,
          dispatchAfterMs: 1000,
        }),
      );
      await scripts.stageBatch(noisyJobs);

      await stageOne({
        tenantId: "proj_quiet",
        groupSuffix: "only",
        stagedJobId: "quiet-j1",
        dispatchAfterMs: 1001,
      });

      // Batch dispatch: gets 1 noisy + 1 quiet (cap=1 each)
      const batch = await scripts.dispatchBatch({
        nowMs: 2000,
        activeTtlSec: 60,
        maxJobs: 10,
      });
      const groupIds = batch.map((r) => r.groupId);
      expect(groupIds).toContain("proj_quiet/only");
      expect(groupIds.filter((g) => g.startsWith("proj_noisy/"))).toHaveLength(
        1,
      );

      // Second batch: both tenants at cap, nothing left to dispatch
      const batch2 = await scripts.dispatchBatch({
        nowMs: 2000,
        activeTtlSec: 60,
        maxJobs: 10,
      });
      expect(batch2).toHaveLength(0);

      // The 19 remaining noisy groups were parked out of ready, not re-deferred
      // within it.
      expect(await redis.zcard(`${keyPrefix()}parked:proj_noisy`)).toBe(19);
      expect(await redis.zcount(`${keyPrefix()}ready`, "-inf", "2000")).toBe(0);
    });

    /** @scenario cap=0 produces zero tenant in-flight slot keys (back-compat regression) */
    it("when cap=0 (kill switch), no tenant_active_z:* keys are ever created", async () => {
      process.env[TENANT_CAP_ENV] = "0";

      const groupId = await stageOne({
        tenantId: "proj_acme",
        groupSuffix: "g1",
        stagedJobId: "j1",
      });
      const dispatched = await scripts.dispatch({
        nowMs: 2000,
        activeTtlSec: 60,
      });
      expect(dispatched).not.toBeNull();

      // Scan for any tenant_active_z:* keys: must be none.
      const keysAfterDispatch = await redis.keys(
        `${keyPrefix()}tenant_active_z:*`,
      );
      expect(keysAfterDispatch).toEqual([]);

      // Round-trip a full lifecycle to confirm no key is created at any
      // step (COMPLETE attempts the free branch even with cap=0; that
      // branch must not silently create keys).
      await scripts.complete({
        groupId,
        stagedJobId: dispatched!.stagedJobId,
      });
      const keysAfterComplete = await redis.keys(
        `${keyPrefix()}tenant_active_z:*`,
      );
      expect(keysAfterComplete).toEqual([]);

      // restageAndBlock path too: re-stage a fresh group and walk the
      // failure path. No ZSET must appear.
      await stageOne({
        tenantId: "proj_acme",
        groupSuffix: "g2",
        stagedJobId: "j2",
      });
      const d2 = await scripts.dispatch({ nowMs: 3000, activeTtlSec: 60 });
      await scripts.restageAndBlock({
        groupId: d2!.groupId,
        newStagedJobId: "j2-restaged",
        score: 9999,
        jobDataJson: JSON.stringify({}),
        errorMessage: "boom",
      });
      const keysAfterRestage = await redis.keys(
        `${keyPrefix()}tenant_active_z:*`,
      );
      expect(keysAfterRestage).toEqual([]);

      // The parking machinery is also fully inert at cap=0: no parked zsets and
      // no parked-tenants registry entry are ever created (protects the live
      // cap=0 mitigation path from any new per-op overhead).
      expect(await redis.keys(`${keyPrefix()}parked:*`)).toEqual([]);
      expect(await redis.exists(`${keyPrefix()}parked-tenants`)).toBe(0);
    });

    // ────────────────────────────────────────────────────────────────────
    // Parking model: over-cap groups are moved OUT of ready into a per-tenant
    // parked zset (once), restored when the tenant drops below cap. This is the
    // durable fix for the 2026-05-27 over-cap ZADD storm, where re-deferring a
    // 442K-deep ready set every 5s saturated single-threaded Redis. Mutual
    // exclusivity (a group is in exactly one of ready/parked/blocked/active) is
    // the load-bearing invariant: every ready-writer must respect parked.
    // ────────────────────────────────────────────────────────────────────
    describe("parking over-cap groups", () => {
      function parkedKey(tenantId: string) {
        return `${keyPrefix()}parked:${tenantId}`;
      }

      /** @scenario A freed in-flight slot restores a parked group on completion */
      it("restores a parked group to ready on completion, preserving its score", async () => {
        process.env[TENANT_CAP_ENV] = "1";
        await stageOne({
          tenantId: "proj_acme",
          groupSuffix: "g1",
          stagedJobId: "j1",
          dispatchAfterMs: 1000,
        });
        await stageOne({
          tenantId: "proj_acme",
          groupSuffix: "g2",
          stagedJobId: "j2",
          dispatchAfterMs: 1500,
        });

        const d1 = await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 });
        expect(d1!.groupId).toBe("proj_acme/g1");
        // Second poll parks g2 (tenant at cap=1) at its original score.
        expect(
          await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 }),
        ).toBeNull();
        expect(
          await redis.zrange(parkedKey("proj_acme"), 0, -1, "WITHSCORES"),
        ).toEqual(["proj_acme/g2", "1500"]);

        // Completing g1 frees the slot → COMPLETE unparks g2 back into ready
        // at its preserved score, and clears the now-empty registry entry.
        await scripts.complete({
          groupId: d1!.groupId,
          stagedJobId: d1!.stagedJobId,
        });
        expect(await redis.zcard(parkedKey("proj_acme"))).toBe(0);
        expect(
          await redis.sismember(`${keyPrefix()}parked-tenants`, "proj_acme"),
        ).toBe(0);
        expect(await redis.zscore(`${keyPrefix()}ready`, "proj_acme/g2")).toBe(
          "1500",
        );

        // g2 is now dispatchable.
        const d2 = await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 });
        expect(d2!.groupId).toBe("proj_acme/g2");
      });

      /** @scenario A crashed tenant's parked groups are restored once its in-flight slots lapse */
      it("reconciles parked groups back to ready when the tenant's in-flight slots lapse (orphan recovery)", async () => {
        process.env[TENANT_CAP_ENV] = "1";
        await stageOne({
          tenantId: "proj_crash",
          groupSuffix: "g1",
          stagedJobId: "j1",
          dispatchAfterMs: 1000,
        });
        await stageOne({
          tenantId: "proj_crash",
          groupSuffix: "g2",
          stagedJobId: "j2",
          dispatchAfterMs: 1001,
        });

        // Dispatch g1 with a short active TTL so its in-flight slot lapses
        // quickly; its slot score = 2000 + 5*1000 = 7000.
        const d1 = await scripts.dispatch({ nowMs: 2000, activeTtlSec: 5 });
        await scripts.dispatch({ nowMs: 2000, activeTtlSec: 5 }); // parks g2
        expect(await redis.zcard(parkedKey("proj_crash"))).toBe(1);
        expect(
          await redis.zscore(tenantActiveZKey("proj_crash"), d1!.groupId),
        ).toBe("7000");

        // Simulate the worker dying ungracefully: no COMPLETE, no heartbeat. The
        // active key expires on its own; we drop it here to mirror that. The
        // tenant's in-flight slot keeps its now-stale score (7000) because
        // nothing refreshes it. No COMPLETE fires, so without self-healing g2
        // would strand forever.
        await redis.del(`${keyPrefix()}group:${d1!.groupId}:active`);

        // A later poll whose nowMs (8000) is past the lapsed slot score (7000):
        // tenantActiveCount GCs the stale member, reads 0 (under cap), and the
        // reconcile restores g2 with NO manual counter reset.
        const recovered = await scripts.dispatch({
          nowMs: 8000,
          activeTtlSec: 5,
        });
        expect(recovered!.groupId).toBe("proj_crash/g2");
        expect(await redis.zcard(parkedKey("proj_crash"))).toBe(0);
        // The lapsed slot was garbage-collected out of the ZSET.
        expect(
          await redis.zscore(tenantActiveZKey("proj_crash"), d1!.groupId),
        ).toBeNull();
      });

      /** @scenario Disabling the cap restores all parked groups */
      it("drains every parked group back to ready when the cap is set to 0", async () => {
        process.env[TENANT_CAP_ENV] = "1";
        for (let i = 1; i <= 3; i++) {
          await stageOne({
            tenantId: "proj_acme",
            groupSuffix: `g${i}`,
            stagedJobId: `j${i}`,
            dispatchAfterMs: 1000 + i,
          });
        }
        await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 }); // g1 active
        await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 }); // parks g2, g3
        expect(await redis.zcard(parkedKey("proj_acme"))).toBe(2);

        // Operator flips the kill switch; a poll past the reconcile interval
        // drains the whole parked set back into ready (cap disabled = nothing
        // should stay parked out of the scan).
        process.env[TENANT_CAP_ENV] = "0";
        await scripts.dispatch({ nowMs: 5000, activeTtlSec: 60 });
        expect(await redis.zcard(parkedKey("proj_acme"))).toBe(0);
        expect(
          await redis.sismember(`${keyPrefix()}parked-tenants`, "proj_acme"),
        ).toBe(0);
      });

      it("drains a large parked backlog in bounded chunks when the cap is set to 0", async () => {
        process.env[TENANT_CAP_ENV] = "0";
        // Seed a large parked backlog directly — the parking mechanism is
        // covered by the tests above; here we isolate the cap=0 kill-switch
        // drain, which must NOT do one unbounded ZRANGE+ZREM/ZADD eval over the
        // whole set (the May-27 442K-scale single-thread block this fix avoids).
        const total = PARK_RECONCILE_MAX_DRAIN + 50;
        const members: (string | number)[] = [];
        for (let i = 0; i < total; i++)
          members.push(1000 + i, `proj_big/g${i}`);
        await redis.zadd(`${keyPrefix()}parked:proj_big`, ...members);
        await redis.sadd(`${keyPrefix()}parked-tenants`, "proj_big");
        expect(await redis.zcard(parkedKey("proj_big"))).toBe(total);

        // First reconcile past the 2s time-gate drains at most one chunk and
        // leaves the tenant registered.
        await scripts.dispatch({ nowMs: 5000, activeTtlSec: 60 });
        expect(await redis.zcard(parkedKey("proj_big"))).toBe(
          total - PARK_RECONCILE_MAX_DRAIN,
        );
        expect(
          await redis.sismember(`${keyPrefix()}parked-tenants`, "proj_big"),
        ).toBe(1);

        // A later reconcile drains the remainder and clears the registry.
        await scripts.dispatch({ nowMs: 8000, activeTtlSec: 60 });
        expect(await redis.zcard(parkedKey("proj_big"))).toBe(0);
        expect(
          await redis.sismember(`${keyPrefix()}parked-tenants`, "proj_big"),
        ).toBe(0);
      });

      /** @scenario Restoring parked groups never exceeds the tenant cap */
      it("unparks no more than (cap - active) groups, so one completion frees exactly one", async () => {
        process.env[TENANT_CAP_ENV] = "2";
        for (let i = 1; i <= 5; i++) {
          await stageOne({
            tenantId: "proj_acme",
            groupSuffix: `g${i}`,
            stagedJobId: `j${i}`,
            dispatchAfterMs: 1000 + i,
          });
        }
        // Real wall-clock nowMs so the active slots' expiry scores stay in the
        // future when COMPLETE runs its lapsed-slot GC against Date.now();
        // otherwise both slots would be GC'd and one completion would over-unpark.
        const now = Date.now();
        const d1 = await scripts.dispatch({ nowMs: now, activeTtlSec: 60 });
        await scripts.dispatch({ nowMs: now, activeTtlSec: 60 });
        expect(await redis.zcard(tenantActiveZKey("proj_acme"))).toBe(2);
        // Next poll parks the remaining 3 (tenant at cap=2).
        expect(
          await scripts.dispatch({ nowMs: now, activeTtlSec: 60 }),
        ).toBeNull();
        expect(await redis.zcard(parkedKey("proj_acme"))).toBe(3);

        // Completing ONE frees exactly one slot → exactly ONE group unparks.
        await scripts.complete({
          groupId: d1!.groupId,
          stagedJobId: d1!.stagedJobId,
        });
        expect(await redis.zcard(parkedKey("proj_acme"))).toBe(2);
        // The single restored group is the only one due in ready (its preserved
        // score is the small staged dispatchAfter, well under the active scores).
        expect(await redis.zcount(`${keyPrefix()}ready`, "-inf", "3000")).toBe(
          1,
        );
      });

      /** @scenario Staging a new job for a parked group keeps it parked */
      it("keeps a parked group parked when a new job is staged for it (STAGE respects parked)", async () => {
        process.env[TENANT_CAP_ENV] = "1";
        await stageOne({
          tenantId: "proj_acme",
          groupSuffix: "g1",
          stagedJobId: "j1",
          dispatchAfterMs: 1000,
        });
        await stageOne({
          tenantId: "proj_acme",
          groupSuffix: "g2",
          stagedJobId: "j2",
          dispatchAfterMs: 1001,
        });
        await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 }); // g1 active
        await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 }); // g2 parked
        expect(await redis.zcard(parkedKey("proj_acme"))).toBe(1);

        // Stage a lower-score job into the already-parked g2.
        await scripts.stage(
          makeJob({
            groupId: "proj_acme/g2",
            stagedJobId: "j2b",
            dispatchAfterMs: 900,
          }),
        );

        // g2 must stay parked (absorbing the lower score there via LT), NOT
        // reappear in the ready scan.
        expect(
          await redis.zscore(`${keyPrefix()}ready`, "proj_acme/g2"),
        ).toBeNull();
        expect(
          await redis.zrange(parkedKey("proj_acme"), 0, -1, "WITHSCORES"),
        ).toEqual(["proj_acme/g2", "900"]);
      });

      // The remaining ready-writers (STAGE_BATCH, RETRY_RESTAGE, ops UNBLOCK and
      // REPLAY_FROM_DLQ) share the same addToReadyOrParked guard. These are extra
      // regression coverage for the mutual-exclusivity invariant beyond the one
      // bound scenario above.
      it("keeps a parked group parked when stageBatch touches it", async () => {
        process.env[TENANT_CAP_ENV] = "1";
        await stageOne({
          tenantId: "proj_acme",
          groupSuffix: "g1",
          stagedJobId: "j1",
          dispatchAfterMs: 1000,
        });
        await stageOne({
          tenantId: "proj_acme",
          groupSuffix: "g2",
          stagedJobId: "j2",
          dispatchAfterMs: 1001,
        });
        await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 });
        await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 }); // parks g2
        expect(await redis.zcard(parkedKey("proj_acme"))).toBe(1);

        await scripts.stageBatch([
          makeJob({
            groupId: "proj_acme/g2",
            stagedJobId: "j2b",
            dispatchAfterMs: 900,
          }),
        ]);

        expect(
          await redis.zscore(`${keyPrefix()}ready`, "proj_acme/g2"),
        ).toBeNull();
        expect(await redis.zscore(parkedKey("proj_acme"), "proj_acme/g2")).toBe(
          "900",
        );
      });

      it("keeps a parked group parked when it is unblocked via the ops repo", async () => {
        process.env[TENANT_CAP_ENV] = "1";
        const repo = new QueueRedisRepository(redis);
        await stageOne({
          tenantId: "proj_acme",
          groupSuffix: "g1",
          stagedJobId: "j1",
          dispatchAfterMs: 1000,
        });
        await stageOne({
          tenantId: "proj_acme",
          groupSuffix: "g2",
          stagedJobId: "j2",
          dispatchAfterMs: 1001,
        });
        await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 });
        await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 }); // parks g2

        // g2 is parked. Force it into the blocked set as if it had been blocked,
        // then unblock it: UNBLOCK must route through the parked-aware write so
        // it does not clobber g2 back into ready.
        await redis.sadd(`${keyPrefix()}blocked`, "proj_acme/g2");
        await repo.unblockGroup({
          queueName: QUEUE_NAME,
          groupId: "proj_acme/g2",
        });

        expect(
          await redis.zscore(`${keyPrefix()}ready`, "proj_acme/g2"),
        ).toBeNull();
        expect(await redis.zcard(parkedKey("proj_acme"))).toBe(1);
      });

      /** @scenario A tenant's in-flight slots self-heal after an ungraceful worker death */
      it("self-heals the tenant cap after an ungraceful mass worker death without an operator reset", async () => {
        process.env[TENANT_CAP_ENV] = "3";

        // A tenant fills its cap with several in-flight groups, plus an extra
        // group that will be parked over-cap.
        for (let i = 1; i <= 4; i++) {
          await stageOne({
            tenantId: "proj_dead",
            groupSuffix: `g${i}`,
            stagedJobId: `j${i}`,
            dispatchAfterMs: 1000 + i,
          });
        }

        // Dispatch fills cap (3 slots) with a short active TTL; each slot's
        // expiry score = 2000 + 5*1000 = 7000. The 4th group is parked.
        const dispatched: DispatchResult[] = [];
        for (let i = 0; i < 4; i++) {
          const d = await scripts.dispatch({ nowMs: 2000, activeTtlSec: 5 });
          if (d) dispatched.push(d);
        }
        expect(dispatched).toHaveLength(3);
        expect(await tenantLiveCount("proj_dead", 2000)).toBe(3);
        expect(await redis.zcard(parkedKey("proj_dead"))).toBe(1);
        expect(
          await redis.sismember(`${keyPrefix()}parked-tenants`, "proj_dead"),
        ).toBe(1);

        // Workers die ungracefully: no COMPLETE, no drain, no heartbeat. The
        // active keys expire on their own; we delete them to mirror that. The
        // in-flight slots keep their now-stale scores (7000) because nothing
        // refreshes them. A scalar counter would stay pinned at 3 forever here.
        for (const d of dispatched) {
          await redis.del(`${keyPrefix()}group:${d.groupId}:active`);
        }
        // Slots are still physically present, just stale.
        expect(await redis.zcard(tenantActiveZKey("proj_dead"))).toBe(3);

        // Liveness lapses past the active TTL: at nowMs=8000 every slot score
        // (7000) is in the past, so the live count is 0 with no operator action.
        expect(await tenantLiveCount("proj_dead", 8000)).toBe(0);

        // A poll past the lapsed scores GCs the dead slots, reads the tenant as
        // under cap, and the reconcile restores the parked group: dispatch
        // resumes for the live tenant with NO manual counter reset.
        const recovered = await scripts.dispatch({
          nowMs: 8000,
          activeTtlSec: 5,
        });
        expect(recovered).not.toBeNull();
        expect(recovered!.groupId).toBe("proj_dead/g4");
        expect(await redis.zcard(parkedKey("proj_dead"))).toBe(0);
        // The stale dead-worker slots were garbage-collected; only the freshly
        // dispatched group counts now.
        expect(await tenantLiveCount("proj_dead", 8000)).toBe(1);
      });
    });
  });

  describe("signal list cap", () => {
    it("trims signal list to max 1000 entries", async () => {
      // Stage many jobs to trigger many LPUSH signals
      const jobs = Array.from({ length: 50 }, (_, i) =>
        makeJob({
          stagedJobId: `j${i}`,
          groupId: `group-${i % 5}`,
          dispatchAfterMs: 100 + i,
        }),
      );

      // Use stageBatch which does LPUSH per affected group
      await scripts.stageBatch(jobs);

      // Manually push many signals to test the cap
      const pipeline = redis.pipeline();
      for (let i = 0; i < 1200; i++) {
        pipeline.lpush(`${keyPrefix()}signal`, "1");
      }
      await pipeline.exec();

      // Now stage one more to trigger LTRIM
      await scripts.stage(
        makeJob({ stagedJobId: "trigger", dispatchAfterMs: 100 }),
      );

      const signals = await inspectSignalList();
      expect(signals.length).toBeLessThanOrEqual(1000);
    });
  });
});

async function inspectTotalPending() {
  return redis.get(`${keyPrefix()}stats:total-pending`);
}

describe("GroupStagingScripts.drainGroupReady", () => {
  describe("when a group has several due jobs", () => {
    it("drains up to maxJobs in ascending score order with their data", async () => {
      await scripts.stage(
        makeJob({
          stagedJobId: "j1",
          dispatchAfterMs: 100,
          jobDataJson: '{"n":1}',
        }),
      );
      await scripts.stage(
        makeJob({
          stagedJobId: "j2",
          dispatchAfterMs: 200,
          jobDataJson: '{"n":2}',
        }),
      );
      await scripts.stage(
        makeJob({
          stagedJobId: "j3",
          dispatchAfterMs: 300,
          jobDataJson: '{"n":3}',
        }),
      );

      const drained = await scripts.drainGroupReady({
        groupId: "group-a",
        nowMs: 10_000,
        maxJobs: 2,
      });

      expect(drained.map((d) => d.stagedJobId)).toEqual(["j1", "j2"]);
      expect(drained.map((d) => d.jobDataJson)).toEqual(['{"n":1}', '{"n":2}']);
      expect(drained.map((d) => d.originalScore)).toEqual([100, 200]);
    });

    it("removes drained jobs from the group's jobs zset and data hash", async () => {
      await scripts.stage(makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }));
      await scripts.stage(makeJob({ stagedJobId: "j2", dispatchAfterMs: 200 }));
      await scripts.stage(makeJob({ stagedJobId: "j3", dispatchAfterMs: 300 }));

      await scripts.drainGroupReady({
        groupId: "group-a",
        nowMs: 10_000,
        maxJobs: 2,
      });

      const jobs = await inspectGroupJobs("group-a");
      expect(jobs).toEqual(["j3", "300"]);
      const data = await inspectDataHash("group-a");
      expect(Object.keys(data)).toEqual(["j3"]);
    });

    /** @scenario 'Draining siblings for coalescing decrements pending per job' */
    it("decrements total-pending by the number drained", async () => {
      await scripts.stage(makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }));
      await scripts.stage(makeJob({ stagedJobId: "j2", dispatchAfterMs: 200 }));
      await scripts.stage(makeJob({ stagedJobId: "j3", dispatchAfterMs: 300 }));
      expect(await inspectTotalPending()).toBe("3");

      await scripts.drainGroupReady({
        groupId: "group-a",
        nowMs: 10_000,
        maxJobs: 2,
      });

      expect(await inspectTotalPending()).toBe("1");
    });
  });

  describe("when the group has an active key and ready entry", () => {
    it("leaves active, ready, and blocked state untouched", async () => {
      await scripts.stage(makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }));
      await scripts.stage(makeJob({ stagedJobId: "j2", dispatchAfterMs: 200 }));
      // Simulate the caller holding the active slot for the dispatched job.
      await redis.set(`${keyPrefix()}group:group-a:active`, "dispatched-job");
      const readyBefore = await inspectReadySet();

      await scripts.drainGroupReady({
        groupId: "group-a",
        nowMs: 10_000,
        maxJobs: 5,
      });

      expect(await inspectActiveKey("group-a")).toBe("dispatched-job");
      expect(await inspectReadySet()).toEqual(readyBefore);
      expect(await inspectBlockedSet()).toEqual([]);
    });
  });

  describe("when some jobs are future-scheduled", () => {
    it("drains only the jobs due at nowMs", async () => {
      await scripts.stage(
        makeJob({ stagedJobId: "due1", dispatchAfterMs: 100 }),
      );
      await scripts.stage(
        makeJob({ stagedJobId: "due2", dispatchAfterMs: 200 }),
      );
      await scripts.stage(
        makeJob({ stagedJobId: "future", dispatchAfterMs: 9_999 }),
      );

      const drained = await scripts.drainGroupReady({
        groupId: "group-a",
        nowMs: 1_000,
        maxJobs: 10,
      });

      expect(drained.map((d) => d.stagedJobId)).toEqual(["due1", "due2"]);
      const jobs = await inspectGroupJobs("group-a");
      expect(jobs).toEqual(["future", "9999"]);
    });
  });

  describe("when maxJobs is zero or negative", () => {
    it("returns empty without touching the group", async () => {
      await scripts.stage(makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }));

      expect(
        await scripts.drainGroupReady({
          groupId: "group-a",
          nowMs: 10_000,
          maxJobs: 0,
        }),
      ).toEqual([]);

      const jobs = await inspectGroupJobs("group-a");
      expect(jobs).toEqual(["j1", "100"]);
      expect(await inspectTotalPending()).toBe("1");
    });
  });

  describe("when the group is empty", () => {
    it("returns empty", async () => {
      expect(
        await scripts.drainGroupReady({
          groupId: "nonexistent",
          nowMs: 10_000,
          maxJobs: 5,
        }),
      ).toEqual([]);
    });
  });
});

describe("group-key TTL safety net", () => {
  async function jobsTtl(groupId: string) {
    return redis.pttl(`${keyPrefix()}group:${groupId}:jobs`);
  }
  async function dataTtl(groupId: string) {
    return redis.pttl(`${keyPrefix()}group:${groupId}:data`);
  }

  function expectFreshTtl(pttl: number) {
    // PTTL set and ~the configured window. The upper bound allows a small
    // delay-derived extension (a job staged a few seconds out pushes expiry to
    // dispatch + window), without admitting the multi-hour long-delay case.
    expect(pttl).toBeGreaterThan(GROUP_KEY_TTL_MS - 60_000);
    expect(pttl).toBeLessThanOrEqual(GROUP_KEY_TTL_MS + 60_000);
  }

  describe("when a job is staged", () => {
    it("sets a bounded TTL on the jobs and data keys", async () => {
      await scripts.stage(makeJob({ stagedJobId: "j1" }));

      expectFreshTtl(await jobsTtl("group-a"));
      expectFreshTtl(await dataTtl("group-a"));
    });
  });

  describe("when a job is scheduled far beyond the safety window", () => {
    it("extends the TTL to its dispatch time so it is not reaped early", async () => {
      const dispatchAfterMs = Date.now() + 25 * 60 * 60 * 1000; // 25h out
      await scripts.stage(makeJob({ stagedJobId: "j1", dispatchAfterMs }));

      // Expiry derives from the scheduled dispatch + window, so it must outlive
      // both the flat 6h window and the job's own due time.
      const pttl = await jobsTtl("group-a");
      expect(pttl).toBeGreaterThan(GROUP_KEY_TTL_MS);
      expect(pttl).toBeGreaterThan(25 * 60 * 60 * 1000);
    });
  });

  describe("when a group is dropped from ready without draining", () => {
    it("its keys still carry a TTL so the strand self-expires", async () => {
      await scripts.stage(makeJob({ stagedJobId: "j1" }));

      // Simulate the incident mitigation: the ready set is cleared, but the
      // group's jobs/data keys are left behind. Before the safety net these
      // lingered forever (the ~82K-key / 4.79GB leak).
      await redis.del(`${keyPrefix()}ready`);

      expect(await inspectReadySet()).toEqual([]);
      expect(await inspectGroupJobs("group-a")).toEqual(["j1", "1000"]);
      expectFreshTtl(await jobsTtl("group-a"));
      expectFreshTtl(await dataTtl("group-a"));
    });
  });

  describe("when a batch of jobs is staged", () => {
    it("sets a TTL on every touched group's keys", async () => {
      await scripts.stageBatch([
        makeJob({ stagedJobId: "j1", groupId: "group-a" }),
        makeJob({ stagedJobId: "j2", groupId: "group-b" }),
      ]);

      expectFreshTtl(await jobsTtl("group-a"));
      expectFreshTtl(await jobsTtl("group-b"));
    });
  });

  describe("when a failed job is re-staged for retry", () => {
    it("refreshes the TTL on the group keys", async () => {
      await scripts.stage(makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }));
      await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });

      await scripts.retryRestage({
        groupId: "group-a",
        stagedJobId: "j1",
        newStagedJobId: "j1/r/1",
        dispatchAfterMs: Date.now() + 5000,
        jobDataJson: JSON.stringify({ retry: true }),
        backoffMs: 5000,
      });

      expectFreshTtl(await jobsTtl("group-a"));
      expectFreshTtl(await dataTtl("group-a"));
    });
  });

  describe("when a group is blocked", () => {
    it("clears the TTL so operator-managed failures are not reaped", async () => {
      await scripts.stage(makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }));
      await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
      await scripts.restageAndBlock({
        groupId: "group-a",
        newStagedJobId: "j1/r/0",
        score: 100,
        jobDataJson: JSON.stringify({ retry: true }),
      });

      expect(await inspectBlockedSet()).toContain("group-a");
      expect(await jobsTtl("group-a")).toBe(-1);
      expect(await dataTtl("group-a")).toBe(-1);
    });
  });

  describe("when an active job heartbeats with pending siblings", () => {
    it("refreshes the pending-sibling jobs/data TTL", async () => {
      await scripts.stage(
        makeJob({ stagedJobId: "active", dispatchAfterMs: 100 }),
      );
      await scripts.stage(
        makeJob({ stagedJobId: "sibling", dispatchAfterMs: 200 }),
      );
      await scripts.dispatch({ nowMs: 300, activeTtlSec: 60 }); // claims "active"

      // Age the sibling keys' TTL well below the window; the heartbeat must
      // bump it back so a long-running active job cannot reap its siblings.
      await redis.pexpire(`${keyPrefix()}group:group-a:jobs`, 5_000);
      await redis.pexpire(`${keyPrefix()}group:group-a:data`, 5_000);

      await scripts.refreshActiveKey({
        groupId: "group-a",
        stagedJobId: "active",
        activeTtlSec: 60,
      });

      expectFreshTtl(await jobsTtl("group-a"));
      expectFreshTtl(await dataTtl("group-a"));
    });
  });

  describe("when a blocked group is unblocked", () => {
    it("restores the safety-net TTL the block path cleared", async () => {
      const repo = new QueueRedisRepository(redis);
      await scripts.stage(makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }));
      await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
      await scripts.restageAndBlock({
        groupId: "group-a",
        newStagedJobId: "j1/r/0",
        score: 100,
        jobDataJson: JSON.stringify({ retry: true }),
      });
      expect(await jobsTtl("group-a")).toBe(-1); // PERSISTed by the block path

      await repo.unblockGroup({ queueName: QUEUE_NAME, groupId: "group-a" });

      expectFreshTtl(await jobsTtl("group-a"));
      expectFreshTtl(await dataTtl("group-a"));
    });
  });

  describe("when a group is replayed from the DLQ", () => {
    it("restores the safety-net TTL on the revived group", async () => {
      const repo = new QueueRedisRepository(redis);
      await scripts.stage(makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }));
      await repo.moveToDlq({ queueName: QUEUE_NAME, groupId: "group-a" });
      await repo.replayFromDlq({ queueName: QUEUE_NAME, groupId: "group-a" });

      expectFreshTtl(await jobsTtl("group-a"));
      expectFreshTtl(await dataTtl("group-a"));
    });
  });
});

describe("queue discovery via registry", () => {
  let repo: QueueRedisRepository;

  beforeEach(() => {
    repo = new QueueRedisRepository(redis);
  });

  describe("when a producer has registered its queue name", () => {
    it("discovers it from the registry set", async () => {
      await scripts.registerQueue();

      expect(await redis.smembers(GROUP_QUEUE_REGISTRY_KEY)).toContain(
        QUEUE_NAME,
      );
      expect(await repo.discoverQueueNames()).toContain(QUEUE_NAME);
    });
  });

  describe("when the registry is empty but a ready set exists", () => {
    it("scans once and backfills the registry", async () => {
      // A ready key exists (a queue ran) but nothing registered yet.
      await redis.zadd(`${keyPrefix()}ready`, 1000, "group-a");

      const names = await repo.discoverQueueNames();

      expect(names).toContain(QUEUE_NAME);
      expect(await redis.smembers(GROUP_QUEUE_REGISTRY_KEY)).toContain(
        QUEUE_NAME,
      );
    });
  });
});
