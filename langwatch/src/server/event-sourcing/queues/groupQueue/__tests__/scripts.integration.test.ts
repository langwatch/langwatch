import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Redis } from "ioredis";
import {
  startTestContainers,
  stopTestContainers,
  getTestRedisConnection,
} from "../../../__tests__/integration/testContainers";
import { GroupStagingScripts, type DispatchResult } from "../scripts";

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

function makeJob(overrides: Partial<Parameters<typeof scripts.stage>[0]> = {}) {
  return {
    stagedJobId: `job-${crypto.randomUUID().slice(0, 8)}`,
    groupId: "group-a",
    dispatchAfterMs: 1000,
    dedupId: "",
    dedupTtlMs: 0,
    jobDataJson: JSON.stringify({ hello: "world" }),
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
        await scripts.stage(makeJob({ stagedJobId: "j1", dispatchAfterMs: 5000 }));

        const jobs = await inspectGroupJobs("group-a");
        expect(jobs).toEqual(["j1", "5000"]);
      });

      it("stores payload in data hash", async () => {
        const payload = JSON.stringify({ key: "value" });
        await scripts.stage(makeJob({ stagedJobId: "j1", jobDataJson: payload }));

        const data = await inspectDataHash("group-a");
        expect(data).toEqual({ j1: payload });
      });

      it("adds group to ready set with sqrt(1) score", async () => {
        await scripts.stage(makeJob());

        const ready = await inspectReadySet();
        // sqrt(1) = 1
        expect(ready).toEqual(["group-a", "1"]);
      });

      it("pushes signal", async () => {
        await scripts.stage(makeJob());

        const signals = await inspectSignalList();
        expect(signals.length).toBeGreaterThanOrEqual(1);
      });

      it("returns true for new job", async () => {
        const result = await scripts.stage(makeJob());
        expect(result).toBe(true);
      });
    });

    describe("when staging with deduplication", () => {
      describe("when dedup key exists", () => {
        it("replaces old job, returns false", async () => {
          const first = await scripts.stage(
            makeJob({
              stagedJobId: "j1",
              dedupId: "dedup-1",
              dedupTtlMs: 60000,
              jobDataJson: JSON.stringify({ version: 1 }),
            }),
          );
          expect(first).toBe(true);

          const second = await scripts.stage(
            makeJob({
              stagedJobId: "j2",
              dedupId: "dedup-1",
              dedupTtlMs: 60000,
              jobDataJson: JSON.stringify({ version: 2 }),
            }),
          );
          expect(second).toBe(false);

          // Only j2 should remain
          const jobs = await inspectGroupJobs("group-a");
          expect(jobs[0]).toBe("j2");

          // Data should contain j2 but not j1
          const data = await inspectDataHash("group-a");
          expect(data["j2"]).toBeDefined();
          expect(data["j1"]).toBeUndefined();
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

          const result = await scripts.stage(
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
  });

  describe("stageBatch", () => {
    describe("when staging for different groups", () => {
      it("creates entries per group and pushes signal", async () => {
        const jobs = [
          makeJob({ stagedJobId: "j1", groupId: "group-x", dispatchAfterMs: 100 }),
          makeJob({ stagedJobId: "j2", groupId: "group-y", dispatchAfterMs: 200 }),
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
        const count = await scripts.stageBatch([
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
  });

  describe("dispatch", () => {
    describe("when group has eligible jobs", () => {
      it("returns oldest job (lowest score <= nowMs)", async () => {
        await scripts.stage(makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }));
        await scripts.stage(makeJob({ stagedJobId: "j2", dispatchAfterMs: 200 }));

        const result = await scripts.dispatch({ nowMs: 300, activeTtlSec: 60 });

        expect(result).not.toBeNull();
        expect(result!.stagedJobId).toBe("j1");
        expect(result!.groupId).toBe("group-a");
      });

      it("sets active key with TTL", async () => {
        await scripts.stage(makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }));

        await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });

        const active = await inspectActiveKey("group-a");
        expect(active).toBe("j1");

        const ttl = await redis.ttl(`${keyPrefix()}group:group-a:active`);
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(60);
      });

      it("removes job from sorted set", async () => {
        await scripts.stage(makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }));

        await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });

        const jobs = await inspectGroupJobs("group-a");
        expect(jobs).toEqual([]);
      });

      it("recalculates ready score or removes group", async () => {
        await scripts.stage(makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }));
        await scripts.stage(makeJob({ stagedJobId: "j2", dispatchAfterMs: 200 }));

        await scripts.dispatch({ nowMs: 300, activeTtlSec: 60 });

        // One job left → score should be sqrt(1) = 1
        const ready = await inspectReadySet();
        expect(ready).toEqual(["group-a", "1"]);
      });

      it("removes group from ready set when no jobs remain", async () => {
        await scripts.stage(makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }));

        await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });

        const ready = await inspectReadySet();
        expect(ready).toEqual([]);
      });

      it("returns jobDataJson from data hash", async () => {
        const payload = JSON.stringify({ test: "data" });
        await scripts.stage(
          makeJob({ stagedJobId: "j1", dispatchAfterMs: 100, jobDataJson: payload }),
        );

        const result = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        expect(result!.jobDataJson).toBe(payload);

        // Data should be cleaned up
        const data = await inspectDataHash("group-a");
        expect(data["j1"]).toBeUndefined();
      });
    });

    describe("when group has active key", () => {
      it("skips group, tries next", async () => {
        // Stage jobs in two groups
        await scripts.stage(makeJob({ stagedJobId: "j1", groupId: "group-a", dispatchAfterMs: 100 }));
        await scripts.stage(makeJob({ stagedJobId: "j2", groupId: "group-b", dispatchAfterMs: 100 }));

        // Dispatch from group with highest score (both have 1 job → same score, order is deterministic by ZREVRANGE)
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
        await scripts.stage(makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }));

        // Manually block the group
        await redis.sadd(`${keyPrefix()}blocked`, "group-a");

        const result = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
        expect(result).toBeNull();
      });
    });

    describe("when no jobs eligible (future dispatchAfterMs)", () => {
      it("returns null", async () => {
        await scripts.stage(makeJob({ stagedJobId: "j1", dispatchAfterMs: 99999 }));

        const result = await scripts.dispatch({ nowMs: 100, activeTtlSec: 60 });
        expect(result).toBeNull();
      });
    });

    describe("when ready set empty", () => {
      it("returns null", async () => {
        const result = await scripts.dispatch({ nowMs: Date.now(), activeTtlSec: 60 });
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

      it("recalculates ready score if more jobs exist", async () => {
        await scripts.stage(makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }));
        await scripts.stage(makeJob({ stagedJobId: "j2", dispatchAfterMs: 200 }));

        const dispatched = (await scripts.dispatch({ nowMs: 300, activeTtlSec: 60 }))!;
        await scripts.complete({
          groupId: dispatched.groupId,
          stagedJobId: dispatched.stagedJobId,
        });

        // j2 still pending → ready score should be sqrt(1) = 1
        const ready = await inspectReadySet();
        expect(ready).toContain("group-a");
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
        expect(await inspectActiveKey(dispatched.groupId)).toBe("some-other-job");
      });
    });
  });

  describe("refreshActiveKey", () => {
    describe("when active key matches", () => {
      it("refreshes TTL, returns true", async () => {
        await scripts.stage(makeJob({ stagedJobId: "j1", dispatchAfterMs: 100 }));
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
        makeJob({ stagedJobId: "a1", groupId: "group-a", dispatchAfterMs: 100 }),
      );
      await scripts.stage(
        makeJob({ stagedJobId: "b1", groupId: "group-b", dispatchAfterMs: 100 }),
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

      const dispatched = (await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 }))!;
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

      const dispatched = (await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 }))!;

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
    function makePausedJobData(overrides: Record<string, unknown> = {}): string {
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
      expect(data["j1"]).toBeDefined();
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

      const blocked = await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 });
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
          makeJob({ stagedJobId: "j1", groupId: "group-a", dispatchAfterMs: 100 }),
        );
        await scripts.stage(
          makeJob({ stagedJobId: "j2", groupId: "group-a", dispatchAfterMs: 200 }),
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
      await scripts.stage(makeJob({ stagedJobId: "trigger", dispatchAfterMs: 100 }));

      const signals = await inspectSignalList();
      expect(signals.length).toBeLessThanOrEqual(1000);
    });
  });
});
