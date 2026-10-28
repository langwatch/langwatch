/** A dead worker loses its claim when its beacon does; specs/claimed-job-recovery.feature. */

import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  CLAIM_GONE_CONFIRM_MS,
  CLAIM_RECHECK_MS,
  type DispatchResult,
  GroupStagingScripts,
} from "../scripts.ts";

const SUITE = "{test/gqreclaim/";
const LONG_ACTIVE_TTL_SEC = 300;

let redis: Redis;

beforeAll(() => {
  redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: 0,
  });
});

afterEach(async () => {
  // Scoped to this suite's own namespace, never flushdb().
  const keys = await redis.keys(`${SUITE}*`);
  if (keys.length > 0) await redis.del(...keys);
});

afterAll(async () => {
  await redis.quit();
});

/** A queue whose tenant cap is one in-flight group, with the dynamic cap off. */
function freshQueue() {
  const name = `${SUITE}${crypto.randomUUID().slice(0, 8)}}`;
  const keyPrefix = `${name}:gq:`;
  const scripts = new GroupStagingScripts(redis, name, {
    tenantConcurrencyCap: 1,
    globalConcurrencyBudget: 0,
  });
  const group = "t1/g1";
  return {
    scripts,
    group,
    activeKey: `${keyPrefix}group:${group}:active`,
    claimedKey: `${keyPrefix}group:${group}:claimed`,
    markerKey: `${keyPrefix}group:${group}:claim`,
    suspectKey: `${keyPrefix}group:${group}:claim:suspect`,
    beaconKey: (workerId: string) => `${keyPrefix}worker:${workerId}`,
    readyScore: async () => Number(await redis.zscore(`${keyPrefix}ready`, group)),
    parked: async () => redis.zscore(`${keyPrefix}parked:t1`, group),
    stage: (stagedJobId: string, score: number) =>
      scripts.stage({
        stagedJobId,
        groupId: group,
        dispatchAfterMs: score,
        dedupId: "",
        dedupTtlMs: 0,
        jobDataJson: JSON.stringify({ stagedJobId }),
      }),
    alive: (workerId: string) => redis.set(`${keyPrefix}worker:${workerId}`, "alive", "EX", 90),
    claim: async ({
      nowMs,
      workerId,
    }: {
      nowMs: number;
      workerId?: string;
    }): Promise<DispatchResult | undefined> => {
      const results = await scripts.dispatchBatch({
        nowMs,
        activeTtlSec: LONG_ACTIVE_TTL_SEC,
        maxJobs: 1,
        ...(workerId ? { claimGuardWorkerId: workerId } : {}),
      });
      return results[0];
    },
  };
}

/** The first dispatch a held group comes due for, with the active key far from lapsing. */
const HELD_DUE_MS = LONG_ACTIVE_TTL_SEC * 500 + 1_000;
/** A dispatch far enough after the first to confirm a missing beacon. */
const CONFIRMED_MS = HELD_DUE_MS + CLAIM_GONE_CONFIRM_MS + 1_000;

/** Redis's clock, which the confirmation reads, a confirmation interval back. */
async function aConfirmationAgo(): Promise<number> {
  const [sec, micro] = await redis.time();
  return Number(sec) * 1_000 + Math.floor(Number(micro) / 1_000) - CLAIM_GONE_CONFIRM_MS - 1_000;
}

/** Moves a recorded suspicion a confirmation interval into the past. */
async function backdateSuspicion(suspectKey: string): Promise<void> {
  const token = (await redis.get(suspectKey))?.split("|")[0];
  await redis.set(suspectKey, `${token}|${await aConfirmationAgo()}`);
}

describe("GroupQueue reclaims a claim whose worker's beacon is gone", () => {
  describe("given a worker that claims a job with its beacon alive and then dies", () => {
    describe("when the group comes up twice, a confirmation apart, while its active key still has most of its life", () => {
      /** @scenario "A group whose worker's beacon is gone is reclaimed before its active key lapses" */
      it("leaves it at the first look, then claims the job again, counts one death and frees the dead claim's tenant slot", async () => {
        const q = freshQueue();
        const now = Date.now();
        await q.stage("job-1", now - 1_000);
        await q.alive("worker-that-dies");
        const first = await q.claim({ nowMs: now, workerId: "worker-that-dies" });
        expect(first?.stagedJobId).toBe("job-1");
        expect(await redis.hget(q.markerKey, "token")).toBe(first?.claimToken);

        await redis.del(q.beaconKey("worker-that-dies"));
        await q.alive("live-worker");
        const firstLook = await q.claim({ nowMs: now + HELD_DUE_MS, workerId: "live-worker" });
        expect(firstLook).toBeUndefined();
        expect(await redis.get(q.activeKey)).toBe("job-1");
        await backdateSuspicion(q.suspectKey);
        // The tenant cap is one, and the dead claim holds that slot: only freeing it lets the
        // reclaimed group be claimed again in the same dispatch rather than parked.
        const second = await q.claim({ nowMs: now + CONFIRMED_MS, workerId: "live-worker" });

        expect(second?.stagedJobId).toBe("job-1");
        expect(second?.claimToken).not.toBe(first?.claimToken);
        expect(await redis.hget(q.markerKey, "owner")).toBe("live-worker");
        expect(await redis.hget(q.markerKey, "deaths")).toBe("1");
        expect(await q.parked()).toBeNull();
      });
    });
  });

  describe("given a worker with its beacon alive holding a group of a tenant at its cap", () => {
    describe("when the group comes up for dispatch", () => {
      /** @scenario "A group held by a live worker is neither reclaimed nor parked when it comes up" */
      it("keeps the claim, does not park the group and brings it up again within the recheck interval", async () => {
        const q = freshQueue();
        const now = Date.now();
        await q.stage("job-1", now - 1_000);
        await q.alive("live-owner");
        const held = await q.claim({ nowMs: now, workerId: "live-owner" });
        await q.alive("other-worker");

        const dispatchedAt = now + HELD_DUE_MS;
        const again = await q.claim({ nowMs: dispatchedAt, workerId: "other-worker" });

        expect(again).toBeUndefined();
        expect(await redis.get(q.activeKey)).toBe("job-1");
        expect(await redis.hget(q.claimedKey, "token")).toBe(held?.claimToken);
        expect(await q.parked()).toBeNull();
        const nextUp = await q.readyScore();
        expect(nextUp).toBeGreaterThan(dispatchedAt);
        expect(nextUp).toBeLessThanOrEqual(dispatchedAt + CLAIM_RECHECK_MS);
      });
    });
  });

  describe("given a worker with its beacon alive whose group is held by a short retry hold", () => {
    describe("when the group comes up with less than the recheck interval left on its active key", () => {
      /** @scenario "A held group whose active key is about to lapse comes up when it lapses" */
      it("brings the group up again when its active key lapses, not a recheck interval later", async () => {
        const q = freshQueue();
        const now = Date.now();
        const holdMs = 5_000;
        await q.stage("job-1", now - 1_000);
        await q.alive("live-owner");
        await q.claim({ nowMs: now, workerId: "live-owner" });
        await redis.pexpire(q.activeKey, holdMs);

        const dispatchedAt = now + HELD_DUE_MS;
        const again = await q.claim({ nowMs: dispatchedAt });

        expect(again).toBeUndefined();
        const nextUp = await q.readyScore();
        expect(nextUp).toBeGreaterThan(dispatchedAt);
        expect(nextUp).toBeLessThanOrEqual(dispatchedAt + holdMs);
      });
    });
  });

  describe("given a worker that retired while it still held a claimed group", () => {
    describe("when the group comes up for dispatch", () => {
      /** @scenario "A retired worker's claim waits for its active key" */
      it("keeps the claim, since a retiring worker is still draining", async () => {
        const q = freshQueue();
        const now = Date.now();
        await q.stage("job-1", now - 1_000);
        await q.alive("retiring-worker");
        const held = await q.claim({ nowMs: now, workerId: "retiring-worker" });
        await redis.set(q.beaconKey("retiring-worker"), "retired", "EX", 600);

        await q.claim({ nowMs: now + HELD_DUE_MS });
        await redis.set(q.suspectKey, `${held?.claimToken}|${await aConfirmationAgo()}`);
        const again = await q.claim({ nowMs: now + CONFIRMED_MS });

        expect(again).toBeUndefined();
        expect(await redis.get(q.activeKey)).toBe("job-1");
        expect(await redis.hget(q.claimedKey, "token")).toBe(held?.claimToken);
      });
    });
  });

  describe("given a claim marker left by a dead worker's earlier claim", () => {
    describe("when a newer claim made without a marker comes up for dispatch", () => {
      /** @scenario "A marker left by an earlier claim does not reclaim a newer one" */
      it("keeps the newer claim, since the marker is not that claim's", async () => {
        const q = freshQueue();
        const now = Date.now();
        await q.stage("job-1", now - 1_000);
        await redis.hset(q.markerKey, {
          owner: "long-dead-worker",
          deaths: "0",
          stagedJobId: "job-0",
          token: "an-earlier-claim",
        });
        const held = await q.claim({ nowMs: now });

        await q.claim({ nowMs: now + HELD_DUE_MS });
        await redis.set(q.suspectKey, `${held?.claimToken}|${await aConfirmationAgo()}`);
        const again = await q.claim({ nowMs: now + CONFIRMED_MS });

        expect(again).toBeUndefined();
        expect(await redis.get(q.activeKey)).toBe("job-1");
        expect(await redis.hget(q.claimedKey, "token")).toBe(held?.claimToken);
      });
    });
  });

  describe("given a worker whose beacon lapsed while Redis was unreachable", () => {
    describe("when its beacon is back by the time the group comes up again", () => {
      /** @scenario "A worker whose beacon lapses for a moment keeps its claim" */
      it("keeps the claim and forgets the missing beacon, so a later lapse starts the confirmation over", async () => {
        const q = freshQueue();
        const now = Date.now();
        await q.stage("job-1", now - 1_000);
        await q.alive("cut-off-worker");
        const held = await q.claim({ nowMs: now, workerId: "cut-off-worker" });
        await redis.del(q.beaconKey("cut-off-worker"));
        await q.claim({ nowMs: now + HELD_DUE_MS });
        expect(await redis.exists(q.suspectKey)).toBe(1);

        await backdateSuspicion(q.suspectKey);
        await q.alive("cut-off-worker");
        await q.claim({ nowMs: now + CONFIRMED_MS });
        expect(await redis.exists(q.suspectKey)).toBe(0);
        await redis.del(q.beaconKey("cut-off-worker"));
        const again = await q.claim({ nowMs: now + CONFIRMED_MS + CLAIM_RECHECK_MS + 1_000 });

        expect(again).toBeUndefined();
        expect(await redis.get(q.activeKey)).toBe("job-1");
        expect(await redis.hget(q.claimedKey, "token")).toBe(held?.claimToken);
        expect(await redis.hget(q.markerKey, "deaths")).toBe("0");
      });
    });
  });

  describe("given a held group whose owner's beacon was just found missing", () => {
    describe("when a worker whose clock runs ten minutes ahead looks at it straight away", () => {
      /** @scenario "A worker whose clock runs ahead does not confirm a missing beacon early" */
      it("keeps the claim, since the confirmation reads Redis's clock", async () => {
        const q = freshQueue();
        const now = Date.now();
        await q.stage("job-1", now - 1_000);
        await q.alive("worker-that-dies");
        const held = await q.claim({ nowMs: now, workerId: "worker-that-dies" });
        await redis.del(q.beaconKey("worker-that-dies"));
        await q.claim({ nowMs: now + HELD_DUE_MS });

        const again = await q.claim({ nowMs: now + HELD_DUE_MS + 10 * 60_000 });

        expect(again).toBeUndefined();
        expect(await redis.hget(q.claimedKey, "token")).toBe(held?.claimToken);
      });
    });
  });

  describe("given a missing beacon recorded against an earlier claim of the group", () => {
    describe("when a newer claim whose owner is gone first comes up for dispatch", () => {
      /** @scenario "A missing beacon seen during an earlier claim does not count toward a newer one" */
      it("keeps the newer claim, since its own confirmation has not started", async () => {
        const q = freshQueue();
        const now = Date.now();
        await q.stage("job-1", now - 1_000);
        await redis.set(q.suspectKey, `an-earlier-claim|${await aConfirmationAgo()}`);
        await q.alive("worker-that-dies");
        const held = await q.claim({ nowMs: now, workerId: "worker-that-dies" });
        await redis.del(q.beaconKey("worker-that-dies"));

        const again = await q.claim({ nowMs: now + HELD_DUE_MS });

        expect(again).toBeUndefined();
        expect(await redis.hget(q.claimedKey, "token")).toBe(held?.claimToken);
        expect((await redis.get(q.suspectKey))?.split("|")[0]).toBe(held?.claimToken);
      });
    });
  });

  describe("given a worker that claims a group with a long active key", () => {
    describe("when it claims the group and when its heartbeat refreshes the claim", () => {
      /** @scenario "A held group comes up for dispatch after its next heartbeat, not when its active key lapses" */
      it("puts the group's next look half the active key's life out: past the heartbeat at a third", async () => {
        const q = freshQueue();
        const now = Date.now();
        const halfLifeMs = LONG_ACTIVE_TTL_SEC * 500;
        await q.stage("job-1", now - 1_000);
        const held = await q.claim({ nowMs: now });
        expect(await q.readyScore()).toBe(now + halfLifeMs);

        await redis.set(q.suspectKey, `${held?.claimToken}|${await aConfirmationAgo()}`);
        const refreshedAt = Date.now();
        const refreshed = await q.scripts.refreshActiveKey({
          groupId: q.group,
          stagedJobId: "job-1",
          claimToken: held?.claimToken ?? "",
          activeTtlSec: LONG_ACTIVE_TTL_SEC,
        });

        expect(refreshed).toBe(true);
        expect(await redis.ttl(q.activeKey)).toBeGreaterThan(LONG_ACTIVE_TTL_SEC - 5);
        expect(await redis.exists(q.suspectKey)).toBe(0);
        expect(await q.readyScore()).toBeGreaterThanOrEqual(refreshedAt + halfLifeMs);
        expect(await q.readyScore()).toBeLessThanOrEqual(Date.now() + halfLifeMs);
      });
    });
  });
});
