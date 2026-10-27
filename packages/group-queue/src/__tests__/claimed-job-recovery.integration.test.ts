/** A claimed job outlives the worker that claimed it; specs/claimed-job-recovery.feature. */

import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { BLOB_RELEASE_GRACE_TTL_SECONDS } from "../blobConstants.ts";
import { blobLeaseSetKey, redisBlobKey } from "../blobKeys.ts";
import type { GroupQueueRuntimeDefinition } from "../contracts.ts";
import { deadLetterJob } from "../deadLetter.ts";
import { NonRetryableGroupQueueError } from "../errors.ts";
import { GroupQueueProcessor } from "../groupQueue.ts";
import { readEnvelopeLease } from "../jobEnvelope.ts";
import { DRAIN_WRITE_CHUNK_JOBS, type DispatchResult, GroupStagingScripts } from "../scripts.ts";
import { InMemoryObjectStore, mintTestUri } from "./blob-test-doubles.ts";

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

  describe("given a claimed group whose middle sibling has lost its body", () => {
    /** @scenario "A drained sibling whose body is gone leaves the group without a recovery copy" */
    it("takes every sibling off the group and the counter and holds only the ones with a body", async () => {
      const q = freshQueue();
      for (const [index, id] of ["j1", "j2", "j3", "j4"].entries()) {
        await q.scripts.stage(stageJob(id, 100 * (index + 1)));
      }
      const claimed = await q.scripts.dispatch({ nowMs: 1_000, activeTtlSec: 60 });
      await redis.hdel(`${q.keyPrefix}group:g1:data`, "j3");

      const siblings = await q.scripts.drainGroupReady({
        groupId: "g1",
        nowMs: 1_000,
        maxJobs: 3,
        claimToken: claimed!.claimToken,
      });

      expect(siblings.map((s) => [s.stagedJobId, s.jobDataJson])).toEqual([
        ["j2", JSON.stringify({ stagedJobId: "j2" })],
        ["j3", ""],
        ["j4", JSON.stringify({ stagedJobId: "j4" })],
      ]);
      expect(await redis.zcard(`${q.keyPrefix}group:g1:jobs`)).toBe(0);
      expect(await q.pending()).toBe(0);
      expect(await redis.hgetall(q.claimedKey("g1"))).toEqual({
        token: claimed!.claimToken,
        "s:j1": "100",
        "d:j1": JSON.stringify({ stagedJobId: "j1" }),
        "s:j2": "200",
        "d:j2": JSON.stringify({ stagedJobId: "j2" }),
        "s:j4": "400",
        "d:j4": JSON.stringify({ stagedJobId: "j4" }),
      });
    });
  });

  describe("given a claimed group whose second sibling would overflow the byte budget", () => {
    /** @scenario "A drain stops at the first sibling that would overflow the byte budget" */
    it("drains only the first sibling and leaves the rest staged in order", async () => {
      const q = freshQueue();
      await q.scripts.stage(stageJob("j1", 100));
      await q.scripts.stage({ ...stageJob("j2", 200), jobDataJson: "a".repeat(10) });
      await q.scripts.stage({ ...stageJob("j3", 300), jobDataJson: "b".repeat(100) });
      await q.scripts.stage({ ...stageJob("j4", 400), jobDataJson: "c".repeat(10) });
      const claimed = await q.scripts.dispatch({ nowMs: 1_000, activeTtlSec: 60 });
      const drain = (initialBytes: number) =>
        q.scripts.drainGroupReady({
          groupId: "g1",
          nowMs: 1_000,
          maxJobs: 3,
          maxBytes: 50,
          initialBytes,
          claimToken: claimed!.claimToken,
        });

      expect((await drain(0)).map((s) => s.stagedJobId)).toEqual(["j2"]);
      const record = await redis.hgetall(q.claimedKey("g1"));
      expect(await drain(10)).toEqual([]);

      expect(await redis.zrange(`${q.keyPrefix}group:g1:jobs`, 0, -1)).toEqual(["j3", "j4"]);
      expect(await q.pending()).toBe(2);
      expect(record).toEqual({
        token: claimed!.claimToken,
        "s:j1": "100",
        "d:j1": JSON.stringify({ stagedJobId: "j1" }),
        "s:j2": "200",
        "d:j2": "a".repeat(10),
      });
      expect(await redis.hgetall(q.claimedKey("g1"))).toEqual(record);
    });
  });

  describe("given a claimed group with more due siblings than one write carries", () => {
    /** @scenario "A drain too large for one write is held whole and comes back in order" */
    it("holds every sibling in the record and brings them all back in order after a death", async () => {
      const q = freshQueue();
      const siblingCount = DRAIN_WRITE_CHUNK_JOBS * 2 + 7;
      const ids = Array.from({ length: siblingCount + 1 }, (_, index) => `j${index}`);
      for (let start = 0; start < ids.length; start += 200) {
        await Promise.all(
          ids
            .slice(start, start + 200)
            .map((id, offset) => q.scripts.stage(stageJob(id, 100 + start + offset))),
        );
      }
      const claimed = await q.scripts.dispatch({ nowMs: 10_000, activeTtlSec: 1 });

      const siblings = await q.scripts.drainGroupReady({
        groupId: "g1",
        nowMs: 10_000,
        maxJobs: siblingCount,
        claimToken: claimed!.claimToken,
      });

      expect(siblings.map((s) => s.stagedJobId)).toEqual(ids.slice(1));
      expect(await q.pending()).toBe(0);
      expect(await redis.hlen(q.claimedKey("g1"))).toBe(1 + 2 * ids.length);
      expect(await redis.pttl(q.claimedKey("g1"))).toBeGreaterThan(0);

      await redis.del(q.activeKey("g1"));
      const again = await q.scripts.dispatch({ nowMs: 20_000, activeTtlSec: 60 });
      expect(again?.stagedJobId).toBe("j0");
      expect(await q.pending()).toBe(siblingCount);
      expect(await redis.zrange(`${q.keyPrefix}group:g1:jobs`, 0, -1)).toEqual(ids.slice(1));
    });
  });

  describe("given a claim whose worker drains siblings without a claim token", () => {
    /** @scenario "A previous-release worker's drain writes nothing into the claimed record" */
    it("takes the siblings off the group and the counter and leaves the record as the claim wrote it", async () => {
      const q = freshQueue();
      await q.scripts.stage(stageJob("j1", 100));
      await q.scripts.stage(stageJob("j2", 200));
      await q.scripts.stage(stageJob("j3", 300));
      const claimed = await q.scripts.dispatch({ nowMs: 1_000, activeTtlSec: 60 });

      const siblings = await q.scripts.drainGroupReady({ groupId: "g1", nowMs: 1_000, maxJobs: 2 });

      expect(siblings.map((s) => s.stagedJobId)).toEqual(["j2", "j3"]);
      expect(await q.pending()).toBe(0);
      expect(await redis.hgetall(q.claimedKey("g1"))).toEqual({
        token: claimed!.claimToken,
        "s:j1": "100",
        "d:j1": JSON.stringify({ stagedJobId: "j1" }),
      });
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

  describe("given a worker whose own claim lapsed and which claimed the group again", () => {
    /** @scenario "A late outcome from a worker's own earlier claim leaves its newer claim alone" */
    it("refuses the earlier claim's completion, retry and block and leaves the newer claim's marker", async () => {
      const q = freshQueue();
      const worker = "worker-that-reclaimed";
      const scripts = new GroupStagingScripts(redis, q.name, { claimMarkerOwner: worker });
      const markerKey = `${q.keyPrefix}group:g1:claim`;
      const claim = async (nowMs: number, activeTtlSec: number) =>
        (
          await scripts.dispatchBatch({
            nowMs,
            activeTtlSec,
            maxJobs: 1,
            claimGuardWorkerId: worker,
          })
        )[0];
      // Dispatch writes the marker only while the worker's beacon is alive.
      await redis.set(`${q.keyPrefix}worker:${worker}`, "alive", "EX", 90);
      await scripts.stage(stageJob("j1", 100));
      await scripts.stage(stageJob("j2", 200));

      // The earlier claim's active key lapses; the same worker claims the group again.
      const earlier = await claim(1_000, 1);
      await redis.del(q.activeKey("g1"));
      const newer = await claim(3_000, 60);
      expect(newer?.stagedJobId).toBe("j1");
      expect(newer?.claimToken).not.toBe(earlier?.claimToken);
      await redis.hset(markerKey, "deaths", "2");

      const state = async () => ({
        marker: await redis.hgetall(markerKey),
        claimed: await redis.hgetall(q.claimedKey("g1")),
        active: await redis.get(q.activeKey("g1")),
        jobs: await redis.zrange(`${q.keyPrefix}group:g1:jobs`, 0, -1, "WITHSCORES"),
        blocked: await redis.sismember(`${q.keyPrefix}blocked`, "g1"),
        pending: await q.pending(),
        completed: await q.completed(),
      });
      const before = await state();
      expect(before.marker).toMatchObject({ owner: worker, deaths: "2", token: newer!.claimToken });

      const late = { groupId: "g1", stagedJobId: "j1", claimToken: earlier!.claimToken };
      expect(await scripts.complete(late)).toBe(false);
      expect(
        await scripts.retryRestage({
          ...late,
          newStagedJobId: "j1",
          dispatchAfterMs: 5_000,
          jobDataJson: earlier!.jobDataJson,
          backoffMs: 1_000,
          attempt: 2,
          attemptTtlSec: 60,
        }),
      ).toBe(false);
      expect(
        await scripts.restageAndBlock({
          groupId: "g1",
          newStagedJobId: "j1",
          score: 100,
          jobDataJson: earlier!.jobDataJson,
          errorMessage: "late failure",
          claimToken: earlier!.claimToken,
        }),
      ).toBe(false);
      expect(await state()).toEqual(before);

      expect(
        await scripts.complete({ groupId: "g1", stagedJobId: "j1", claimToken: newer!.claimToken }),
      ).toBe(true);
      expect(await redis.exists(markerKey)).toBe(0);
    });
  });

  describe("given a former owner that dead-letters and re-stages after its claim was recovered", () => {
    /** @scenario "A former owner's dead-letter and re-stage leave the recovering worker's state alone" */
    it("refuses both writes and leaves the new owner's claim, siblings and staged jobs as they were", async () => {
      const q = freshQueue();
      await q.scripts.stage(stageJob("j1", 100));
      await q.scripts.stage(stageJob("j2", 200));
      await q.scripts.stage(stageJob("j3", 300));

      const slow = await q.scripts.dispatch({ nowMs: 1_000, activeTtlSec: 1 });
      await q.scripts.drainGroupReady({
        groupId: "g1",
        nowMs: 1_000,
        maxJobs: 1,
        claimToken: slow!.claimToken,
      });
      await waitForExpiry(q.activeKey("g1"));
      const current = await q.scripts.dispatch({ nowMs: 3_000, activeTtlSec: 60 });
      await q.scripts.drainGroupReady({
        groupId: "g1",
        nowMs: 3_000,
        maxJobs: 1,
        claimToken: current!.claimToken,
      });
      const newOwnerRecord = await redis.hgetall(q.claimedKey("g1"));

      const deadLetter = (jobId: string, jobDataJson: string) =>
        deadLetterJob({
          redis,
          keyPrefix: q.keyPrefix,
          groupId: "g1",
          jobId,
          score: 100,
          jobDataJson,
          errorMessage: "handler failed",
          errorStack: "",
          claimToken: slow!.claimToken,
        });
      expect(await deadLetter("j1", JSON.stringify({ stagedJobId: "j1" }))).toBe("claim-lost");
      expect(await deadLetter("j3", "")).toBe("claim-lost");
      expect(
        await q.scripts.stage({ ...stageJob("j2", 200), claimToken: slow!.claimToken }),
      ).toEqual({ isNew: false, orphanedValue: "", claimLost: true });

      expect(newOwnerRecord).toEqual({
        token: current!.claimToken,
        "s:j1": "100",
        "d:j1": JSON.stringify({ stagedJobId: "j1" }),
        "s:j2": "200",
        "d:j2": JSON.stringify({ stagedJobId: "j2" }),
      });
      expect(await redis.hgetall(q.claimedKey("g1"))).toEqual(newOwnerRecord);
      expect(await redis.get(q.activeKey("g1"))).toBe("j1");
      expect(await redis.zrange(`${q.keyPrefix}group:g1:jobs`, 0, -1)).toEqual(["j3"]);
      expect(await redis.exists(`${q.keyPrefix}dlq:g1:jobs`)).toBe(0);
      expect(await q.pending()).toBe(1);

      expect(
        await q.scripts.complete({
          groupId: "g1",
          stagedJobId: "j1",
          claimToken: current!.claimToken,
        }),
      ).toBe(true);
      expect((await q.scripts.dispatch({ nowMs: 4_000, activeTtlSec: 60 }))?.stagedJobId).toBe(
        "j3",
      );
    });
  });

  describe("given an offloaded job whose claim was recovered while the first worker's handler ran", () => {
    /** The first worker fails the job for good; the recovering worker's lease must survive it. */
    async function failAfterRecovery(outcome: "block" | "dead-letter") {
      const q = freshQueue();
      const groupId = "proj1/agg";
      let recovered: DispatchResult | null = null;
      const deadAudits: unknown[] = [];
      const processor = new GroupQueueProcessor<TestPayload & { value: string }>(
        {
          name: q.name,
          groupKey: (p) => p.groupId,
          identify: (p) => p.id,
          onExhausted: () => outcome,
          auditAdapter: {
            onEnqueue: async () => {},
            onLeased: async () => {},
            onDispatched: async () => {},
            onFailed: async () => {},
            onDead: async (event) => {
              deadAudits.push(event);
            },
          },
          process: async () => {
            await redis.del(q.activeKey(groupId));
            recovered = await q.scripts.dispatch({ nowMs: Date.now() + 60_000, activeTtlSec: 60 });
            throw new NonRetryableGroupQueueError("handler failed for good");
          },
        },
        redis,
        {
          consumerEnabled: false,
          objectStoreFor: () => new InMemoryObjectStore(),
          mintUri: mintTestUri,
          resolveStorageDestination: async () => ({ kind: "s3", bucket: "test-bucket" }),
        },
      );
      processors.push(processor);
      // Over the inline ceiling, under the object-store threshold: a Redis-tier blob.
      await processor.send({ id: "job-1", groupId, value: "x".repeat(8 * 1024) });
      // A second job keeps the group on the ready set, so a later claim finds the lapsed one.
      await processor.send({ id: "job-2", groupId, value: "" });
      const first = await q.scripts.dispatch({ nowMs: Date.now(), activeTtlSec: 60 });
      const lease = readEnvelopeLease(first!.jobDataJson);
      expect(lease?.ref.tier).toBe("redis");

      await processor["processClaimedJob"](first!);

      expect(recovered!.jobDataJson).toBe(first!.jobDataJson);
      const leaseKey = blobLeaseSetKey({
        queueName: q.name,
        projectId: lease!.ref.projectId,
        hash: lease!.ref.hash,
      });
      const blobKey = redisBlobKey({
        queueName: q.name,
        projectId: lease!.ref.projectId,
        hash: lease!.ref.hash,
      });
      return {
        holderScore: await redis.zscore(leaseKey, lease!.holderId),
        blobTtl: await redis.ttl(blobKey),
        deadAudits,
      };
    }

    /** @scenario "A former owner's failure keeps the payload lease the recovering worker relies on" */
    it.each(["block", "dead-letter"] as const)(
      "keeps the recovered job's lease and the blob's lifetime and reports nothing dead when it would %s",
      async (outcome) => {
        const { holderScore, blobTtl, deadAudits } = await failAfterRecovery(outcome);
        expect(holderScore).not.toBeNull();
        expect(blobTtl).toBeGreaterThan(BLOB_RELEASE_GRACE_TTL_SECONDS);
        expect(deadAudits).toEqual([]);
      },
    );
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

  describe("given a worker that dead-letters the job it claimed and dies before completing", () => {
    /** @scenario "A dead-lettered job is not brought back by a later claim" */
    it("leaves the job in the dead-letter queue and claims nothing again", async () => {
      const q = freshQueue();
      await q.scripts.stage(stageJob("j1", 100));

      await q.scripts.dispatch({ nowMs: 1_000, activeTtlSec: 1 });
      const moved = await deadLetterJob({
        redis,
        keyPrefix: q.keyPrefix,
        groupId: "g1",
        jobId: "j1",
        score: 100,
        jobDataJson: JSON.stringify({ stagedJobId: "j1" }),
        errorMessage: "handler failed",
        errorStack: "",
      });
      expect(moved).toBe("moved");
      await waitForExpiry(q.activeKey("g1"));

      expect(await q.scripts.dispatch({ nowMs: 3_000, activeTtlSec: 60 })).toBeNull();
      expect(await redis.zrange(`${q.keyPrefix}dlq:g1:jobs`, 0, -1)).toEqual(["j1"]);
      expect(await q.pending()).toBe(0);
    });
  });
});
