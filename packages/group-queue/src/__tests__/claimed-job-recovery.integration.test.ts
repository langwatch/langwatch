/** A claimed job outlives the worker that claimed it; specs/claimed-job-recovery.feature. */

import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { GroupQueueRuntimeDefinition } from "../contracts.ts";
import { GroupQueueProcessor } from "../groupQueue.ts";
import { GroupStagingScripts } from "../scripts.ts";

type TestPayload = { id: string; groupId: string };

const SUITE = "{test/gqrecover/";

let redis: Redis;
const processors: GroupQueueProcessor<TestPayload>[] = [];

beforeAll(() => {
  redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: 0,
  });
});

afterEach(async () => {
  await Promise.all(processors.splice(0).map((p) => p.close().catch(() => {})));
  // Scoped to this suite's own namespace, never flushdb().
  const keys = await redis.keys(`${SUITE}*`);
  if (keys.length > 0) await redis.del(...keys);
});

afterAll(async () => {
  await redis.quit();
});

function freshQueue() {
  const name = `${SUITE}${crypto.randomUUID().slice(0, 8)}}`;
  const keyPrefix = `${name}:gq:`;
  return {
    name,
    keyPrefix,
    scripts: new GroupStagingScripts(redis, name),
    pending: async () => Number(await redis.get(`${keyPrefix}stats:total-pending`)) || 0,
    completed: async () => Number(await redis.get(`${keyPrefix}stats:completed`)) || 0,
    activeKey: (groupId: string) => `${keyPrefix}group:${groupId}:active`,
    claimedKey: (groupId: string) => `${keyPrefix}group:${groupId}:claimed`,
  };
}

function stageJob(stagedJobId: string, score: number) {
  return {
    stagedJobId,
    groupId: "g1",
    dispatchAfterMs: score,
    dedupId: "",
    dedupTtlMs: 0,
    jobDataJson: JSON.stringify({ stagedJobId }),
  };
}

/** The dead worker never refreshes, so its short-lived active key lapses on its own. */
async function waitForExpiry(key: string): Promise<void> {
  await vi.waitFor(async () => expect(await redis.exists(key)).toBe(0), {
    timeout: 6_000,
    interval: 50,
  });
}

describe("GroupQueue claimed-job recovery", () => {
  describe("given a worker that claims the first of two jobs and dies", () => {
    /** @scenario "A job claimed by a worker that dies is run by another worker" */
    it("has a live worker run the first job exactly once more, then the second", async () => {
      const q = freshQueue();
      const definition = (
        process: GroupQueueRuntimeDefinition<TestPayload>["process"],
      ): GroupQueueRuntimeDefinition<TestPayload> => ({
        name: q.name,
        groupKey: (p) => p.groupId,
        identify: (p) => p.id,
        process,
      });
      const producer = new GroupQueueProcessor<TestPayload>(
        definition(async () => {}),
        redis,
        { consumerEnabled: false },
      );
      processors.push(producer);
      await producer.send({ id: "job-1", groupId: "g1" });
      await producer.send({ id: "job-2", groupId: "g1" });

      const claimed = await q.scripts.dispatch({ nowMs: Date.now(), activeTtlSec: 1 });
      expect(claimed?.groupId).toBe("g1");
      // The dead worker's claim marker names a worker with no beacon: a vanished owner.
      await q.scripts.recordClaim({
        groupId: "g1",
        workerId: "worker-that-died",
        stagedJobId: claimed!.stagedJobId,
      });
      await waitForExpiry(q.activeKey("g1"));

      const ran: string[] = [];
      const deathsSeen: number[] = [];
      const live = new GroupQueueProcessor<TestPayload>(
        definition(async (payload) => {
          ran.push(payload.id);
          deathsSeen.push(Number(await redis.hget(`${q.keyPrefix}group:g1:claim`, "deaths")));
        }),
        redis,
      );
      processors.push(live);
      await live.waitUntilReady();

      await vi.waitFor(() => expect(ran).toEqual(["job-1", "job-2"]), {
        timeout: 20_000,
        interval: 50,
      });
      expect(deathsSeen[0]).toBe(1);
      await vi.waitFor(async () => expect(await q.pending()).toBe(0), { timeout: 5_000 });
      expect(await redis.exists(q.claimedKey("g1"))).toBe(0);
    });
  });

  describe("given a worker that claims a job, drains two siblings into its batch and dies", () => {
    /** @scenario "A batch claimed by a dead worker comes back in order" */
    it("claims the three jobs again in their original order with the counter conserved", async () => {
      const q = freshQueue();
      await q.scripts.stage(stageJob("j1", 100));
      await q.scripts.stage(stageJob("j2", 200));
      await q.scripts.stage(stageJob("j3", 300));

      const first = await q.scripts.dispatch({ nowMs: 1_000, activeTtlSec: 1 });
      const firstSiblings = await q.scripts.drainGroupReady({
        groupId: "g1",
        nowMs: 1_000,
        maxJobs: 2,
        claimToken: first!.claimToken,
      });
      expect([first!.stagedJobId, ...firstSiblings.map((s) => s.stagedJobId)]).toEqual([
        "j1",
        "j2",
        "j3",
      ]);
      expect(await q.pending()).toBe(0);
      await waitForExpiry(q.activeKey("g1"));

      const again = await q.scripts.dispatch({ nowMs: 3_000, activeTtlSec: 60 });
      expect(again?.stagedJobId).toBe("j1");
      expect(again?.claimToken).not.toBe(first!.claimToken);
      expect(again?.jobDataJson).toBe(JSON.stringify({ stagedJobId: "j1" }));
      expect(await q.pending()).toBe(2);

      const siblings = await q.scripts.drainGroupReady({
        groupId: "g1",
        nowMs: 3_000,
        maxJobs: 2,
        claimToken: again!.claimToken,
      });
      expect(siblings.map((s) => s.stagedJobId)).toEqual(["j2", "j3"]);
      expect(await q.pending()).toBe(0);

      expect(
        await q.scripts.complete({
          groupId: "g1",
          stagedJobId: "j1",
          claimToken: again!.claimToken,
        }),
      ).toBe(true);
      expect(await redis.exists(q.claimedKey("g1"))).toBe(0);
      expect(await q.scripts.dispatch({ nowMs: 4_000, activeTtlSec: 60 })).toBeNull();
      expect(await q.pending()).toBe(0);
    });
  });

  describe("given a worker whose claim was recovered by a second worker while it ran", () => {
    /** @scenario "A slow former owner's completion does not double-complete" */
    it("changes nothing on the late completion and lets the second worker complete once", async () => {
      const q = freshQueue();
      await q.scripts.stage(stageJob("j1", 100));
      await q.scripts.stage(stageJob("j2", 200));

      const slow = await q.scripts.dispatch({ nowMs: 1_000, activeTtlSec: 1 });
      await waitForExpiry(q.activeKey("g1"));
      const current = await q.scripts.dispatch({ nowMs: 3_000, activeTtlSec: 60 });
      expect(current?.stagedJobId).toBe("j1");

      const lost = { groupId: "g1", stagedJobId: "j1", claimToken: slow!.claimToken };
      expect(await q.scripts.complete(lost)).toBe(false);
      expect(await q.scripts.refreshActiveKey({ ...lost, activeTtlSec: 60 })).toBe(false);
      expect(await q.scripts.drainGroupReady({ ...lost, nowMs: 3_000, maxJobs: 5 })).toEqual([]);
      expect(await redis.get(q.activeKey("g1"))).toBe("j1");
      expect(await redis.hget(q.claimedKey("g1"), "token")).toBe(current!.claimToken);
      expect(await q.completed()).toBe(0);

      expect(
        await q.scripts.complete({
          groupId: "g1",
          stagedJobId: "j1",
          claimToken: current!.claimToken,
        }),
      ).toBe(true);
      expect(await q.completed()).toBe(1);
      const next = await q.scripts.dispatch({ nowMs: 4_000, activeTtlSec: 60 });
      expect(next?.stagedJobId).toBe("j2");
      await q.scripts.complete({ groupId: "g1", stagedJobId: "j2", claimToken: next!.claimToken });
      expect(await q.completed()).toBe(2);
      expect(await q.pending()).toBe(0);
    });
  });

  describe("given a worker whose active key lapsed before anyone recovered its claim", () => {
    /** @scenario "A worker that still owns its claim completes it after its active key lapsed" */
    it("completes the job and no later claim brings it back", async () => {
      const q = freshQueue();
      await q.scripts.stage(stageJob("j1", 100));

      const claimed = await q.scripts.dispatch({ nowMs: 1_000, activeTtlSec: 1 });
      await waitForExpiry(q.activeKey("g1"));

      expect(
        await q.scripts.complete({
          groupId: "g1",
          stagedJobId: "j1",
          claimToken: claimed!.claimToken,
        }),
      ).toBe(true);
      expect(await redis.exists(q.claimedKey("g1"))).toBe(0);
      expect(await q.scripts.dispatch({ nowMs: 3_000, activeTtlSec: 60 })).toBeNull();
      expect(await q.pending()).toBe(0);
      expect(await q.completed()).toBe(1);
    });
  });

  describe("given a worker that claims a job and re-stages it for a retry", () => {
    /** @scenario "A claimed job that is retried is not brought back a second time" */
    it("claims the job once after the backoff, with the counter conserved", async () => {
      const q = freshQueue();
      await q.scripts.stage(stageJob("j1", 100));

      const claimed = await q.scripts.dispatch({ nowMs: 1_000, activeTtlSec: 60 });
      const restaged = await q.scripts.retryRestage({
        groupId: "g1",
        stagedJobId: "j1",
        newStagedJobId: "j1",
        dispatchAfterMs: 1_500,
        jobDataJson: JSON.stringify({ stagedJobId: "j1", __attempt: 2 }),
        backoffMs: 0,
        attempt: 2,
        attemptTtlSec: 60,
        claimToken: claimed!.claimToken,
      });
      expect(restaged).toBe(true);
      expect(await redis.exists(q.claimedKey("g1"))).toBe(0);
      expect(await q.pending()).toBe(1);
      await waitForExpiry(q.activeKey("g1"));

      const retried = await q.scripts.dispatch({ nowMs: 5_000, activeTtlSec: 60 });
      expect(retried?.stagedJobId).toBe("j1");
      expect(await q.pending()).toBe(0);
      expect(await redis.zcard(`${q.keyPrefix}group:g1:jobs`)).toBe(0);
      await q.scripts.complete({
        groupId: "g1",
        stagedJobId: "j1",
        claimToken: retried!.claimToken,
      });
      expect(await q.scripts.dispatch({ nowMs: 6_000, activeTtlSec: 60 })).toBeNull();
      expect(await q.pending()).toBe(0);
    });
  });
});
