import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GroupQueueProcessor } from "../groupQueue.ts";
import { type DispatchResult, GroupStagingScripts } from "../scripts.ts";
import { beaconKey, claimKey } from "./poisonGuardFixtures.ts";

/**
 * A claim's bookkeeping in as few round trips as its semantics allow
 * (specs/claim-round-trips.feature): batched outcomes keep each group's own claim token and
 * answer; the poison guard's marker rides the claim and its outcome.
 */

type TestPayload = { id: string; groupId: string; value: number };

const WAIT = { timeout: 30_000, interval: 50 };

let redis: Redis;
let queueName = "";
const queues: GroupQueueProcessor<TestPayload>[] = [];

beforeAll(() => {
  redis = new IORedis(
    process.env.LANGWATCH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? "redis://localhost:6379",
    { maxRetriesPerRequest: 0 },
  );
});

beforeEach(() => {
  queueName = `{test/claim-trips/${crypto.randomUUID().slice(0, 8)}}`;
});

afterEach(async () => {
  await Promise.all(queues.splice(0).map((queue) => queue.close().catch(() => {})));
  const keys = await redis.keys("{test/claim-trips/*");
  if (keys.length > 0) await redis.del(...keys);
});

afterAll(async () => {
  await redis.quit();
});

const groupKey = (groupId: string, suffix: string) => `${queueName}:gq:group:${groupId}:${suffix}`;

const groupsOf = (count: number) =>
  Array.from({ length: count }, (_, index) => `tenant-a/group-${index}`);

/** Stages one due job per group and claims them all. */
async function claimGroups({
  scripts,
  groupIds,
  activeTtlSec = 60,
  claimGuardWorkerId,
}: {
  scripts: GroupStagingScripts;
  groupIds: string[];
  activeTtlSec?: number;
  claimGuardWorkerId?: string;
}): Promise<DispatchResult[]> {
  for (const groupId of groupIds) {
    await scripts.stage({
      stagedJobId: `${groupId}#0`,
      groupId,
      dispatchAfterMs: 1000,
      dedupId: "",
      dedupTtlMs: 0,
      jobDataJson: JSON.stringify({ groupId }),
    });
  }
  const claims = await scripts.dispatchBatch({
    nowMs: Date.now(),
    activeTtlSec,
    maxJobs: groupIds.length,
    ...(claimGuardWorkerId ? { claimGuardWorkerId } : {}),
  });
  expect(claims).toHaveLength(groupIds.length);
  return claims;
}

/** Another worker recovered this claim: its token no longer names it. */
async function recoverElsewhere(claim: DispatchResult | undefined): Promise<string> {
  const groupId = claim?.groupId ?? "";
  await redis.hset(groupKey(groupId, "claimed"), "token", "another-worker");
  return groupId;
}

describe("completeMany", () => {
  describe("given sixteen claimed groups, one of them recovered by another worker", () => {
    /** @scenario "A batch's completions leave in one round trip, each fenced by its own claim" */
    it("completes fifteen and fences the stale one, leaving its new claim untouched", async () => {
      const scripts = new GroupStagingScripts(redis, queueName);
      const claims = await claimGroups({ scripts, groupIds: groupsOf(16) });
      const staleGroup = await recoverElsewhere(claims[5]);

      const results = await scripts.completeMany(
        claims.map((claim) => ({
          groupId: claim.groupId,
          stagedJobId: claim.stagedJobId,
          claimToken: claim.claimToken,
          endsRetryChain: true,
        })),
      );

      expect(results.map((result) => result.status === "fulfilled" && result.value)).toEqual(
        claims.map((claim) => claim.groupId !== staleGroup),
      );
      const active = await Promise.all(
        claims.map((claim) => redis.exists(groupKey(claim.groupId, "active"))),
      );
      expect(active).toEqual(claims.map((claim) => (claim.groupId === staleGroup ? 1 : 0)));
      expect(await redis.hget(groupKey(staleGroup, "claimed"), "token")).toBe("another-worker");
      expect(await redis.get(`${queueName}:gq:stats:completed`)).toBe("15");
    });
  });
});

describe("heartbeatMany", () => {
  describe("given claimed groups whose leases are about to lapse", () => {
    /** @scenario "Every live group's lease in a batch is renewed in one round trip" */
    it("renews every lease, and refuses only a claim another worker recovered", async () => {
      const scripts = new GroupStagingScripts(redis, queueName);
      const claims = await claimGroups({ scripts, groupIds: groupsOf(5), activeTtlSec: 5 });
      const staleGroup = await recoverElsewhere(claims[4]);

      const results = await scripts.heartbeatMany({
        activeTtlSec: 300,
        heartbeats: claims.map((claim) => ({
          groupId: claim.groupId,
          stagedJobId: claim.stagedJobId,
          claimToken: claim.claimToken,
        })),
      });

      expect(results.map((result) => result.status === "fulfilled" && result.value)).toEqual([
        true,
        true,
        true,
        true,
        false,
      ]);
      const ttls = await Promise.all(
        claims.map((claim) => redis.ttl(groupKey(claim.groupId, "active"))),
      );
      const renewed = claims.map((claim, index) =>
        claim.groupId === staleGroup ? (ttls[index] ?? 0) <= 5 : (ttls[index] ?? 0) > 200,
      );
      expect(renewed).toEqual([true, true, true, true, true]);
    });
  });
});

describe("retryRestageMany", () => {
  describe("given claimed groups failing together, one of them recovered by another worker", () => {
    /** @scenario "A batch's retries leave in one round trip, each fenced by its own claim" */
    it("re-stages and advances the chain of every owned group, and none of the stale one", async () => {
      const scripts = new GroupStagingScripts(redis, queueName);
      const claims = await claimGroups({ scripts, groupIds: groupsOf(3) });
      const staleGroup = await recoverElsewhere(claims[1]);

      const results = await scripts.retryRestageMany(
        claims.map((claim) => ({
          groupId: claim.groupId,
          stagedJobId: claim.stagedJobId,
          newStagedJobId: claim.stagedJobId,
          dispatchAfterMs: Date.now() + 1000,
          jobDataJson: claim.jobDataJson,
          backoffMs: 1000,
          attempt: 2,
          attemptTtlSec: 60,
          claimToken: claim.claimToken,
        })),
      );

      expect(results.map((result) => result.status === "fulfilled" && result.value)).toEqual([
        true,
        false,
        true,
      ]);
      for (const claim of claims) {
        const owned = claim.groupId !== staleGroup;
        expect(await redis.zcard(groupKey(claim.groupId, "jobs"))).toBe(owned ? 1 : 0);
        expect(await redis.get(groupKey(claim.groupId, "attempt"))).toBe(owned ? "2" : null);
      }
    });
  });
});

describe("the poison guard's claim marker", () => {
  describe("given a worker whose beacon is alive", () => {
    /** @scenario "The claim marker is written with the claim once the worker's beacon is alive" */
    it("writes the marker in the claim and answers with its deaths", async () => {
      const scripts = new GroupStagingScripts(redis, queueName);
      await redis.set(beaconKey(queueName, "worker-a"), "alive", "EX", 90);

      const [claim] = await claimGroups({
        scripts,
        groupIds: groupsOf(1),
        claimGuardWorkerId: "worker-a",
      });

      expect(claim?.claimGuard).toEqual({ deaths: 0, lastOwnerState: "none" });
      expect(await redis.hget(claimKey(queueName, claim?.groupId ?? ""), "owner")).toBe("worker-a");
    });
  });

  describe("given a worker whose beacon is missing", () => {
    /** @scenario "A claim made without a live beacon writes no marker" */
    it("claims the group and writes no marker", async () => {
      const scripts = new GroupStagingScripts(redis, queueName);

      const [claim] = await claimGroups({
        scripts,
        groupIds: groupsOf(1),
        claimGuardWorkerId: "worker-without-beacon",
      });

      expect(claim?.claimGuard).toBeUndefined();
      expect(await redis.exists(claimKey(queueName, claim?.groupId ?? ""))).toBe(0);
    });
  });

  describe("given a completion by the marker's owner and one by a worker that lost it", () => {
    /** @scenario "Every outcome releases only a marker this worker still owns" */
    it("releases the owner's marker and leaves the new owner's intact", async () => {
      await redis.set(beaconKey(queueName, "worker-a"), "alive", "EX", 90);
      const owner = new GroupStagingScripts(redis, queueName, { claimMarkerOwner: "worker-a" });
      const [kept, handedOver] = await claimGroups({
        scripts: owner,
        groupIds: groupsOf(2),
        claimGuardWorkerId: "worker-a",
      });
      const handedOverGroup = handedOver?.groupId ?? "";
      await redis.hset(claimKey(queueName, handedOverGroup), { owner: "worker-c", deaths: "2" });

      await owner.completeMany(
        [kept, handedOver].map((claim) => ({
          groupId: claim?.groupId ?? "",
          stagedJobId: claim?.stagedJobId ?? "",
          claimToken: claim?.claimToken ?? "",
        })),
      );

      expect(await redis.exists(claimKey(queueName, kept?.groupId ?? ""))).toBe(0);
      expect(await redis.hgetall(claimKey(queueName, handedOverGroup))).toMatchObject({
        owner: "worker-c",
        deaths: "2",
      });
    });
  });

  describe("given a group whose last three claimants died without retiring", () => {
    /** @scenario "A group is still parked after three confirmed deaths" */
    it("parks the group at the next claim, before its job runs", async () => {
      const definition = {
        name: queueName,
        groupKey: (payload: TestPayload) => payload.groupId,
        identify: (payload: TestPayload) => payload.id,
      };
      const processed = vi.fn(async (_payload: TestPayload) => {});
      const producer = new GroupQueueProcessor<TestPayload>(
        { ...definition, process: processed },
        redis,
        { consumerEnabled: false },
      );
      queues.push(producer);
      const groupId = "tenant-a/poison";
      await producer.send({ id: "job-1", groupId, value: 0 });

      const scripts = new GroupStagingScripts(redis, queueName);
      const deathsSeen: (number | undefined)[] = [];
      for (const dead of ["dead-1", "dead-2", "dead-3"]) {
        await redis.set(beaconKey(queueName, dead), "alive", "EX", 90);
        const [claim] = await scripts.dispatchBatch({
          nowMs: Date.now() + 60_000,
          activeTtlSec: 60,
          maxJobs: 1,
          claimGuardWorkerId: dead,
        });
        deathsSeen.push(claim?.claimGuard?.deaths);
        // The claimant dies: no beacon, no retirement, and its lease lapses.
        await redis.del(beaconKey(queueName, dead), groupKey(groupId, "active"));
        await redis.zadd(`${queueName}:gq:ready`, 0, groupId);
      }
      expect(deathsSeen).toEqual([0, 1, 2]);

      const consumer = new GroupQueueProcessor<TestPayload>(
        { ...definition, process: processed },
        redis,
      );
      queues.push(consumer);
      await consumer.waitUntilReady();

      await vi.waitFor(async () => {
        expect(await redis.smembers(`${queueName}:gq:blocked`)).toContain(groupId);
      }, WAIT);
      expect(processed).not.toHaveBeenCalled();
      expect(await redis.zcard(groupKey(groupId, "jobs"))).toBe(1);
    });
  });
});

describe("given a worker of the previous release beside a worker of this one", () => {
  /** @scenario "An old and a new worker share the claim markers and drain one queue" */
  it("runs every job once and in order, parks nothing and leaves no marker of the new worker", async () => {
    const seen = new Map<string, number[]>();
    const process = async (payload: TestPayload) => {
      const list = seen.get(payload.groupId) ?? [];
      list.push(payload.value);
      seen.set(payload.groupId, list);
    };
    const definition = {
      name: queueName,
      groupKey: (payload: TestPayload) => payload.groupId,
      identify: (payload: TestPayload) => payload.id,
      score: (payload: TestPayload) => 1_000 + payload.value,
      process,
    };
    const older = new GroupQueueProcessor<TestPayload>(definition, redis);
    const newer = new GroupQueueProcessor<TestPayload>(definition, redis);
    queues.push(older, newer);
    // The previous release records the marker in its own round trip and its outcome scripts
    // release none (it released separately); it runs the same keys and marker fields.
    Object.assign(older, { claimGuardWorkerId: () => undefined });
    Object.assign(older["scripts"], { claimMarkerOwner: "" });
    await Promise.all([older.waitUntilReady(), newer.waitUntilReady()]);

    const groupIds = groupsOf(24);
    for (let value = 0; value < 6; value += 1) {
      await newer.sendBatch(
        groupIds.map((groupId) => ({ id: `${groupId}#${value}`, groupId, value })),
      );
    }

    const total = () => [...seen.values()].flat().length;
    await vi.waitFor(() => expect(total()).toBe(groupIds.length * 6), WAIT);
    for (const groupId of groupIds) expect(seen.get(groupId)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(await redis.smembers(`${queueName}:gq:blocked`)).toEqual([]);
    // The last completions may still be in flight when the last handler returns.
    const newerId = newer["workerId"];
    await vi.waitFor(async () => {
      for (const groupId of groupIds) {
        const marker = await redis.hgetall(claimKey(queueName, groupId));
        expect(marker.owner).not.toBe(newerId);
        expect(marker.deaths ?? "0").toBe("0");
      }
    }, WAIT);
  });
});

const BATCH_ROUTE = "trace_processing/projection/traceSummary";
const PAUSED_ROUTE = "trace_processing/command/recordSpan";

/** A stored envelope whose header names its handler; `ref` makes it a blob-shaped one. */
function routedBody({
  route,
  marker,
  ref,
}: {
  route: string;
  marker: string;
  ref?: { projectId: string; hash: string };
}): string {
  const [p, t, n] = route.split("/");
  const blob = ref
    ? { v: 2, e: "redis", ref: { tier: "redis", ...ref }, h: `holder-${marker}` }
    : {};
  const header = JSON.stringify({ ...blob, p, t, n, x: marker });
  return `GQ2|${Buffer.byteLength(header)}|${header}`;
}

async function stageOne({
  scripts,
  groupId,
  stagedJobId,
  score,
  jobDataJson,
}: {
  scripts: GroupStagingScripts;
  groupId: string;
  stagedJobId: string;
  score: number;
  jobDataJson: string;
}): Promise<void> {
  await scripts.stage({
    stagedJobId,
    groupId,
    dispatchAfterMs: score,
    dedupId: "",
    dedupTtlMs: 0,
    jobDataJson,
  });
}

/**
 * Every command Redis runs on this queue's keys while `run` executes, scripts' inner ones included.
 */
async function commandsDuring(run: () => Promise<unknown>): Promise<string[][]> {
  const monitor = await redis.monitor();
  const end = `${queueName}:monitor-end:${crypto.randomUUID()}`;
  const seen: string[][] = [];
  const ended = new Promise<void>((resolve) => {
    monitor.on("monitor", (_time: string, args: string[]) => {
      const [command, ...rest] = args;
      if (rest[0] === end) {
        resolve();
        return;
      }
      const touchesQueue = rest.some((arg) => arg.startsWith(queueName));
      if (touchesQueue) seen.push([command?.toUpperCase() ?? "", ...rest]);
    });
  });
  try {
    await run();
    await redis.get(end);
    await ended;
  } finally {
    monitor.disconnect();
  }
  return seen;
}

const callsOf = (seen: string[][], command: string, key: string) =>
  seen.filter((args) => args[0] === command && args[1] === key).length;

describe("the claim's reads and writes", () => {
  const batch = { maxGroups: 4, routes: [BATCH_ROUTE], maxClaims: 0 };

  describe("given ready groups of one handler beside a group of a paused handler", () => {
    /** @scenario "A claim reads each claimed job's body once" */
    it("reads each examined body once and keeps it in the claimed record for recovery", async () => {
      const scripts = new GroupStagingScripts(redis, queueName);
      const bodies = {
        "tenant-a/g1": routedBody({ route: BATCH_ROUTE, marker: "g1" }),
        "tenant-a/g2": routedBody({
          route: BATCH_ROUTE,
          marker: "g2",
          ref: { projectId: "tenant-a", hash: "h2" },
        }),
        "tenant-a/g3": routedBody({ route: PAUSED_ROUTE, marker: "g3" }),
      };
      let score = 1000;
      for (const [groupId, jobDataJson] of Object.entries(bodies)) {
        await stageOne({
          scripts,
          groupId,
          stagedJobId: `${groupId}#0`,
          score: score++,
          jobDataJson,
        });
      }
      await redis.sadd(`${queueName}:gq:paused-jobs`, PAUSED_ROUTE);

      let claims: DispatchResult[] = [];
      const seen = await commandsDuring(async () => {
        claims = await scripts.dispatchBatch({
          nowMs: Date.now(),
          activeTtlSec: 1,
          maxJobs: 2,
          groupBatch: batch,
        });
      });

      expect(claims.map((claim) => [claim.groupId, claim.jobDataJson, claim.batchSlot])).toEqual([
        ["tenant-a/g1", bodies["tenant-a/g1"], 1],
        ["tenant-a/g2", bodies["tenant-a/g2"], 1],
      ]);
      for (const groupId of Object.keys(bodies)) {
        expect(callsOf(seen, "HGET", groupKey(groupId, "data"))).toBe(1);
      }
      for (const [index, claim] of claims.entries()) {
        expect(await redis.hgetall(groupKey(claim.groupId, "claimed"))).toEqual({
          token: claim.claimToken,
          [`s:${claim.stagedJobId}`]: String(1000 + index),
          [`d:${claim.stagedJobId}`]: claim.jobDataJson,
        });
      }
      expect(await redis.zscore(`${queueName}:gq:ready`, "tenant-a/g3")).toBeNull();
      expect(await redis.zcard(groupKey("tenant-a/g3", "jobs"))).toBe(1);

      for (const claim of claims) await redis.del(groupKey(claim.groupId, "active"));
      const again = await scripts.dispatchBatch({
        nowMs: Date.now() + 120_000,
        activeTtlSec: 60,
        maxJobs: 2,
      });
      expect(again.map((claim) => [claim.groupId, claim.jobDataJson])).toEqual([
        ["tenant-a/g1", bodies["tenant-a/g1"]],
        ["tenant-a/g2", bodies["tenant-a/g2"]],
      ]);
    });
  });

  describe("given full slots whose only open batch belongs to another tenant", () => {
    /** @scenario "A group that cannot join any open batch is not read" */
    it("leaves the other tenant's groups unread and ready", async () => {
      const scripts = new GroupStagingScripts(redis, queueName);
      const groupIds = ["tenant-a/g1", "tenant-a/g2", "tenant-b/g1", "tenant-b/g2"];
      for (const [index, groupId] of groupIds.entries()) {
        await stageOne({
          scripts,
          groupId,
          stagedJobId: `${groupId}#0`,
          score: 1000 + index,
          jobDataJson: routedBody({ route: BATCH_ROUTE, marker: groupId }),
        });
      }

      let claims: DispatchResult[] = [];
      const seen = await commandsDuring(async () => {
        claims = await scripts.dispatchBatch({
          nowMs: Date.now(),
          activeTtlSec: 60,
          maxJobs: 1,
          groupBatch: batch,
        });
      });

      expect(claims.map((claim) => claim.groupId)).toEqual(["tenant-a/g1", "tenant-a/g2"]);
      expect(callsOf(seen, "HGET", groupKey("tenant-b/g1", "data"))).toBe(0);
      expect(callsOf(seen, "HGET", groupKey("tenant-b/g2", "data"))).toBe(0);
      expect(await redis.zscore(`${queueName}:gq:ready`, "tenant-b/g1")).toBe("1002");
      expect(await redis.zscore(`${queueName}:gq:ready`, "tenant-b/g2")).toBe("1003");
    });
  });

  describe("given a ready group whose head job has lost its body", () => {
    /** @scenario "A claimed job whose body is missing is looked up once" */
    it("looks the body up once and claims the job with no body and no recovery copy", async () => {
      const scripts = new GroupStagingScripts(redis, queueName);
      const groupId = "tenant-a/g1";
      await stageOne({
        scripts,
        groupId,
        stagedJobId: "j1",
        score: 1000,
        jobDataJson: routedBody({ route: BATCH_ROUTE, marker: "j1" }),
      });
      await redis.hdel(groupKey(groupId, "data"), "j1");

      let claims: DispatchResult[] = [];
      const seen = await commandsDuring(async () => {
        claims = await scripts.dispatchBatch({
          nowMs: Date.now(),
          activeTtlSec: 60,
          maxJobs: 1,
          groupBatch: batch,
        });
      });

      expect(claims.map((claim) => [claim.stagedJobId, claim.jobDataJson])).toEqual([["j1", ""]]);
      expect(callsOf(seen, "HGET", groupKey(groupId, "data"))).toBe(1);
      expect(await redis.hgetall(groupKey(groupId, "claimed"))).toEqual({
        token: claims[0]?.claimToken,
      });
      expect(await redis.get(`${queueName}:gq:stats:total-pending`)).toBe("0");
    });
  });

  describe("given a claimed group with six due siblings", () => {
    /** @scenario "Draining siblings into a claim writes each key once" */
    it("reads each body once and writes the jobs, bodies, counter and record once each", async () => {
      const scripts = new GroupStagingScripts(redis, queueName);
      const groupId = "tenant-a/g1";
      for (let index = 0; index < 7; index++) {
        await stageOne({
          scripts,
          groupId,
          stagedJobId: `j${index}`,
          score: 1000 + index,
          jobDataJson: JSON.stringify({ index }),
        });
      }
      const [claim] = await scripts.dispatchBatch({ nowMs: 5_000, activeTtlSec: 60, maxJobs: 1 });

      let drained: { stagedJobId: string }[] = [];
      const seen = await commandsDuring(async () => {
        drained = await scripts.drainGroupReady({
          groupId,
          nowMs: 5_000,
          maxJobs: 6,
          claimToken: claim!.claimToken,
        });
      });

      expect(drained.map((job) => job.stagedJobId)).toEqual(["j1", "j2", "j3", "j4", "j5", "j6"]);
      expect(callsOf(seen, "HGET", groupKey(groupId, "data"))).toBe(6);
      expect(callsOf(seen, "ZREM", groupKey(groupId, "jobs"))).toBe(1);
      expect(callsOf(seen, "HDEL", groupKey(groupId, "data"))).toBe(1);
      expect(callsOf(seen, "HSET", groupKey(groupId, "claimed"))).toBe(1);
      expect(callsOf(seen, "PEXPIRE", groupKey(groupId, "claimed"))).toBe(1);
      const counterKey = `${queueName}:gq:stats:total-pending`;
      expect(callsOf(seen, "DECRBY", counterKey) + callsOf(seen, "DECR", counterKey)).toBe(1);
      expect(await redis.get(counterKey)).toBe("0");
      expect(await redis.hlen(groupKey(groupId, "claimed"))).toBe(1 + 2 * 7);
    });
  });
});
