import IORedis, { type Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { type DispatchResult, GroupStagingScripts } from "../scripts";

let redis: Redis;
let scripts: GroupStagingScripts;
const QUEUE_NAME = "{test/tenant-soft-cap}";

function keyPrefix() {
  return `${QUEUE_NAME}:gq:`;
}

function tenantActiveZKey(tenantId: string) {
  return `${keyPrefix()}tenant_active_z:${tenantId}`;
}

function parkedKey(tenantId: string) {
  return `${keyPrefix()}parked:${tenantId}`;
}

async function inspectReadySet() {
  return redis.zrange(`${keyPrefix()}ready`, 0, -1, "WITHSCORES");
}

// Live in-flight count for a tenant = ZSET members whose expiry score is
// strictly in the future (> nowMs); a slot at-or-past nowMs has lapsed.
async function tenantLiveCount(tenantId: string, nowMs: number) {
  return redis.zcount(tenantActiveZKey(tenantId), `(${nowMs}`, "+inf");
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

// Parity with specs/group-queue/tenant-soft-cap.feature
describe("tenant soft-cap (LANGWATCH_DISPATCH_TENANT_CAP)", () => {
  /** @scenario An in-flight slot is added on dispatch and removed on completion */
  it("adds the group to the tenant ZSET on dispatch and removes it on completion", async () => {
    scripts = new GroupStagingScripts(redis, QUEUE_NAME, { tenantConcurrencyCap: 10 });
    const groupId = await stageOne({ tenantId: "proj_acme", groupSuffix: "g1", stagedJobId: "j1" });

    const dispatched = await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 });
    expect(dispatched?.groupId).toBe(groupId);

    expect(await redis.zcard(tenantActiveZKey("proj_acme"))).toBe(1);
    expect(await redis.zscore(tenantActiveZKey("proj_acme"), groupId)).toBe("62000");

    expect(await tenantLiveCount("proj_acme", 61999)).toBe(1);
    expect(await tenantLiveCount("proj_acme", 62000)).toBe(0);

    await scripts.complete({ groupId, stagedJobId: dispatched!.stagedJobId });
    expect(await redis.zcard(tenantActiveZKey("proj_acme"))).toBe(0);
    expect(await redis.exists(tenantActiveZKey("proj_acme"))).toBe(0);
  });

  /** @scenario RESTAGE_AND_BLOCK removes the in-flight slot on exhausted retries */
  it("RESTAGE_AND_BLOCK_LUA removes the tenant slot (preventing slot leak on terminal failures)", async () => {
    scripts = new GroupStagingScripts(redis, QUEUE_NAME, { tenantConcurrencyCap: 10 });
    const groupId = await stageOne({ tenantId: "proj_acme", groupSuffix: "g1", stagedJobId: "j1" });
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
    scripts = new GroupStagingScripts(redis, QUEUE_NAME, { tenantConcurrencyCap: 10 });
    const groupId = await stageOne({ tenantId: "proj_acme", groupSuffix: "g1", stagedJobId: "j1" });
    const dispatched = await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 });

    expect(await redis.zscore(tenantActiveZKey("proj_acme"), groupId)).toBe("62000");

    await scripts.refreshActiveKey({
      groupId,
      stagedJobId: dispatched!.stagedJobId,
      activeTtlSec: 60,
    });

    const score = Number(await redis.zscore(tenantActiveZKey("proj_acme"), groupId));
    const expectedExpiry = Date.now() + 60 * 1000;
    expect(score).toBeGreaterThan(62000);
    expect(Math.abs(score - expectedExpiry)).toBeLessThanOrEqual(2000);
  });

  /** @scenario RETRY_RESTAGE bumps the in-flight slot expiry to the retry window */
  it("RETRY_RESTAGE_LUA bumps the tenant slot's expiry score to the retry window", async () => {
    scripts = new GroupStagingScripts(redis, QUEUE_NAME, { tenantConcurrencyCap: 10 });
    const groupId = await stageOne({ tenantId: "proj_acme", groupSuffix: "g1", stagedJobId: "j1" });
    const dispatched = await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 });

    await scripts.retryRestage({
      groupId,
      stagedJobId: dispatched!.stagedJobId,
      newStagedJobId: "j1-retry",
      dispatchAfterMs: 9999,
      jobDataJson: JSON.stringify({ hello: "world" }),
      backoffMs: 30_000,
      attempt: 1,
      attemptTtlSec: 1800,
    });

    // retryRestage sets the slot expiry to Date.now() + retryTtlSec*1000,
    // retryTtlSec = ceil(backoffMs/1000)+2 = 32s.
    const score = Number(await redis.zscore(tenantActiveZKey("proj_acme"), groupId));
    const expectedExpiry = Date.now() + 32 * 1000;
    expect(score).toBeGreaterThan(0);
    expect(Math.abs(score - expectedExpiry)).toBeLessThanOrEqual(2000);
  });

  /** @scenario DISPATCH_BATCH_LUA refuses to dispatch when tenant is at cap */
  it("refuses to dispatch a group whose tenant is already at cap", async () => {
    scripts = new GroupStagingScripts(redis, QUEUE_NAME, { tenantConcurrencyCap: 2 });
    await stageOne({ tenantId: "proj_noisy", groupSuffix: "g1", stagedJobId: "j1" });
    await stageOne({ tenantId: "proj_noisy", groupSuffix: "g2", stagedJobId: "j2" });
    await stageOne({ tenantId: "proj_noisy", groupSuffix: "g3", stagedJobId: "j3" });

    expect(await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 })).not.toBeNull();
    expect(await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 })).not.toBeNull();
    expect(await redis.zcard(tenantActiveZKey("proj_noisy"))).toBe(2);

    const third = await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 });
    expect(third).toBeNull();
    expect(await redis.zcard(tenantActiveZKey("proj_noisy"))).toBe(2);
    const ready = await inspectReadySet();
    expect(ready.some((s) => s === "proj_noisy/g3")).toBe(false);
    expect(await redis.zcard(`${keyPrefix()}parked:proj_noisy`)).toBe(1);
    expect(await redis.sismember(`${keyPrefix()}parked-tenants`, "proj_noisy")).toBe(1);
  });

  /** @scenario Over-cap tenant at the head of the zset does not starve other tenants */
  it("widened scan budget walks past over-cap tenant's groups to serve a quiet tenant deeper in the zset", async () => {
    scripts = new GroupStagingScripts(redis, QUEUE_NAME, { tenantConcurrencyCap: 1 });

    const noisyJobs = Array.from({ length: 50 }, (_, i) =>
      makeJob({ groupId: `proj_noisy/g${i}`, stagedJobId: `noisy-j${i}`, dispatchAfterMs: 1000 }),
    );
    await scripts.stageBatch(noisyJobs);

    await stageOne({
      tenantId: "proj_quiet",
      groupSuffix: "only",
      stagedJobId: "quiet-j1",
      dispatchAfterMs: 1001,
    });

    const first = await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 });
    expect(first?.groupId).toMatch(/^proj_noisy\//);
    expect(await redis.zcard(tenantActiveZKey("proj_noisy"))).toBe(1);

    const second = await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 });
    expect(second).not.toBeNull();
    expect(second!.groupId).toBe("proj_quiet/only");
    expect(await redis.zcard(tenantActiveZKey("proj_quiet"))).toBe(1);
  });

  /** @scenario Over-cap groups are parked out of ready so they don't starve other tenants on repeated polls */
  it("parks over-cap groups out of ready so the next dispatch reaches other tenants immediately", async () => {
    scripts = new GroupStagingScripts(redis, QUEUE_NAME, { tenantConcurrencyCap: 1 });

    const noisyJobs = Array.from({ length: 50 }, (_, i) =>
      makeJob({ groupId: `proj_noisy/g${i}`, stagedJobId: `noisy-j${i}`, dispatchAfterMs: 1000 }),
    );
    await scripts.stageBatch(noisyJobs);

    await stageOne({
      tenantId: "proj_quiet",
      groupSuffix: "only",
      stagedJobId: "quiet-j1",
      dispatchAfterMs: 1001,
    });

    const first = await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 });
    expect(first?.groupId).toMatch(/^proj_noisy\//);

    const second = await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 });
    expect(second!.groupId).toBe("proj_quiet/only");

    const third = await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 });
    expect(third).toBeNull();

    expect(await redis.zcard(`${keyPrefix()}parked:proj_noisy`)).toBe(49);
    expect(await redis.sismember(`${keyPrefix()}parked-tenants`, "proj_noisy")).toBe(1);
    expect(await redis.zcount(`${keyPrefix()}ready`, "-inf", "2000")).toBe(0);
  });

  /** @scenario dispatchBatch parks over-cap groups the same way */
  it("dispatchBatch parks over-cap groups out of ready", async () => {
    scripts = new GroupStagingScripts(redis, QUEUE_NAME, { tenantConcurrencyCap: 1 });

    const noisyJobs = Array.from({ length: 20 }, (_, i) =>
      makeJob({ groupId: `proj_noisy/g${i}`, stagedJobId: `noisy-j${i}`, dispatchAfterMs: 1000 }),
    );
    await scripts.stageBatch(noisyJobs);

    await stageOne({
      tenantId: "proj_quiet",
      groupSuffix: "only",
      stagedJobId: "quiet-j1",
      dispatchAfterMs: 1001,
    });

    const batch = await scripts.dispatchBatch({ nowMs: 2000, activeTtlSec: 60, maxJobs: 10 });
    const groupIds = batch.map((r) => r.groupId);
    expect(groupIds).toContain("proj_quiet/only");
    expect(groupIds.filter((g) => g.startsWith("proj_noisy/"))).toHaveLength(1);

    const batch2 = await scripts.dispatchBatch({ nowMs: 2000, activeTtlSec: 60, maxJobs: 10 });
    expect(batch2).toHaveLength(0);

    expect(await redis.zcard(`${keyPrefix()}parked:proj_noisy`)).toBe(19);
    expect(await redis.zcount(`${keyPrefix()}ready`, "-inf", "2000")).toBe(0);
  });

  /** @scenario cap=0 produces zero tenant in-flight slot keys */
  it("when cap=0 (kill switch), no tenant_active_z:* keys are ever created", async () => {
    scripts = new GroupStagingScripts(redis, QUEUE_NAME, { tenantConcurrencyCap: 0 });

    const groupId = await stageOne({ tenantId: "proj_acme", groupSuffix: "g1", stagedJobId: "j1" });
    const dispatched = await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 });
    expect(dispatched).not.toBeNull();

    expect(await redis.keys(`${keyPrefix()}tenant_active_z:*`)).toEqual([]);

    await scripts.complete({ groupId, stagedJobId: dispatched!.stagedJobId });
    expect(await redis.keys(`${keyPrefix()}tenant_active_z:*`)).toEqual([]);

    await stageOne({ tenantId: "proj_acme", groupSuffix: "g2", stagedJobId: "j2" });
    const d2 = await scripts.dispatch({ nowMs: 3000, activeTtlSec: 60 });
    await scripts.restageAndBlock({
      groupId: d2!.groupId,
      newStagedJobId: "j2-restaged",
      score: 9999,
      jobDataJson: JSON.stringify({}),
      errorMessage: "boom",
    });
    expect(await redis.keys(`${keyPrefix()}tenant_active_z:*`)).toEqual([]);

    expect(await redis.keys(`${keyPrefix()}parked:*`)).toEqual([]);
    expect(await redis.exists(`${keyPrefix()}parked-tenants`)).toBe(0);
  });

  describe("when tenant cap interacts with dispatchBatch", () => {
    /** @scenario DISPATCH_BATCH skips over-cap groups and dispatches under-cap groups in one call */
    it("over-cap tenant groups are skipped, under-cap tenant groups dispatch", async () => {
      scripts = new GroupStagingScripts(redis, QUEUE_NAME, { tenantConcurrencyCap: 1 });

      for (let i = 0; i < 5; i++) {
        await scripts.stage(
          makeJob({ stagedJobId: `noisy-j${i}`, groupId: `proj_noisy/g${i}`, dispatchAfterMs: 1000 }),
        );
      }
      await scripts.stage(
        makeJob({ stagedJobId: "quiet-j1", groupId: "proj_quiet/g1", dispatchAfterMs: 1001 }),
      );

      const results = await scripts.dispatchBatch({ nowMs: 2000, activeTtlSec: 60, maxJobs: 10 });

      const dispatched = results.map((r) => r.groupId);
      expect(dispatched).toContain("proj_noisy/g0");
      expect(dispatched).toContain("proj_quiet/g1");
      expect(dispatched).toHaveLength(2);
    });

    /** @scenario Over-cap tenant with a blocked group does not affect other tenants */
    it("over-cap tenant blocked group is skipped without affecting other tenants", async () => {
      scripts = new GroupStagingScripts(redis, QUEUE_NAME, { tenantConcurrencyCap: 2 });

      await scripts.stage(makeJob({ stagedJobId: "j1", groupId: "proj_noisy/g1", dispatchAfterMs: 1000 }));
      await scripts.stage(makeJob({ stagedJobId: "j2", groupId: "proj_noisy/g2", dispatchAfterMs: 1000 }));
      await scripts.stage(makeJob({ stagedJobId: "j3", groupId: "proj_noisy/g3", dispatchAfterMs: 1000 }));
      await scripts.stage(
        makeJob({ stagedJobId: "quiet-j1", groupId: "proj_quiet/g1", dispatchAfterMs: 1001 }),
      );

      const first = await scripts.dispatchBatch({ nowMs: 2000, activeTtlSec: 60, maxJobs: 10 });
      expect(first.map((r) => r.groupId)).toContain("proj_noisy/g1");
      expect(first.map((r) => r.groupId)).toContain("proj_noisy/g2");
      expect(first.map((r) => r.groupId)).not.toContain("proj_noisy/g3");
      expect(first.map((r) => r.groupId)).toContain("proj_quiet/g1");

      await scripts.restageAndBlock({
        groupId: "proj_noisy/g1",
        newStagedJobId: "j1-retry",
        score: 5000,
        jobDataJson: first.find((r) => r.groupId === "proj_noisy/g1")!.jobDataJson,
        errorMessage: "test",
      });
      await scripts.complete({
        groupId: "proj_quiet/g1",
        stagedJobId: first.find((r) => r.groupId === "proj_quiet/g1")!.stagedJobId,
      });
      scripts = new GroupStagingScripts(redis, QUEUE_NAME, { tenantConcurrencyCap: 1 });

      await scripts.stage(
        makeJob({ stagedJobId: "quiet-j2", groupId: "proj_quiet/g2", dispatchAfterMs: 3001 }),
      );

      const second = await scripts.dispatchBatch({ nowMs: 4000, activeTtlSec: 60, maxJobs: 10 });

      expect(second.map((r) => r.groupId)).not.toContain("proj_noisy/g1");
      expect(second.map((r) => r.groupId)).not.toContain("proj_noisy/g3");
      expect(second.map((r) => r.groupId)).toContain("proj_quiet/g2");
    });

    /** @scenario Drift cleanup runs for under-cap tenants in batch dispatch */
    it("drift cleanup still runs for under-cap tenants with empty job ZSETs", async () => {
      scripts = new GroupStagingScripts(redis, QUEUE_NAME, { tenantConcurrencyCap: 10 });

      await scripts.stage(makeJob({ stagedJobId: "j1", groupId: "proj_acme/g1", dispatchAfterMs: 1000 }));

      const batch1 = await scripts.dispatchBatch({ nowMs: 2000, activeTtlSec: 60, maxJobs: 10 });
      expect(batch1).toHaveLength(1);

      await scripts.complete({ groupId: "proj_acme/g1", stagedJobId: batch1[0]!.stagedJobId });

      await redis.zadd(`${keyPrefix()}ready`, 2500, "proj_acme/g-zombie");
      const readyBefore = await inspectReadySet();
      expect(readyBefore).toContain("proj_acme/g-zombie");

      await scripts.dispatchBatch({ nowMs: 3000, activeTtlSec: 60, maxJobs: 10 });

      const readyAfter = await inspectReadySet();
      expect(readyAfter).not.toContain("proj_acme/g-zombie");
    });
  });

  describe("parking over-cap groups", () => {
    /** @scenario A freed in-flight slot restores a parked group on completion */
    it("restores a parked group to ready on completion, preserving its score", async () => {
      scripts = new GroupStagingScripts(redis, QUEUE_NAME, { tenantConcurrencyCap: 1 });
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
      expect(await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 })).toBeNull();
      expect(await redis.zrange(parkedKey("proj_acme"), 0, -1, "WITHSCORES")).toEqual([
        "proj_acme/g2",
        "1500",
      ]);

      await scripts.complete({ groupId: d1!.groupId, stagedJobId: d1!.stagedJobId });
      expect(await redis.zcard(parkedKey("proj_acme"))).toBe(0);
      expect(await redis.sismember(`${keyPrefix()}parked-tenants`, "proj_acme")).toBe(0);
      expect(await redis.zscore(`${keyPrefix()}ready`, "proj_acme/g2")).toBe("1500");

      const d2 = await scripts.dispatch({ nowMs: 2000, activeTtlSec: 60 });
      expect(d2!.groupId).toBe("proj_acme/g2");
    });

    /** @scenario A crashed tenant's parked groups are restored once its in-flight slots lapse */
    it("reconciles parked groups back to ready when the tenant's in-flight slots lapse (orphan recovery)", async () => {
      scripts = new GroupStagingScripts(redis, QUEUE_NAME, { tenantConcurrencyCap: 1 });
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

      const d1 = await scripts.dispatch({ nowMs: 2000, activeTtlSec: 5 });
      await scripts.dispatch({ nowMs: 2000, activeTtlSec: 5 }); // parks g2
      expect(await redis.zcard(parkedKey("proj_crash"))).toBe(1);
      expect(await redis.zscore(tenantActiveZKey("proj_crash"), d1!.groupId)).toBe("7000");

      await redis.del(`${keyPrefix()}group:${d1!.groupId}:active`);

      const recovered = await scripts.dispatch({ nowMs: 8000, activeTtlSec: 5 });
      expect(recovered!.groupId).toBe("proj_crash/g2");
      expect(await redis.zcard(parkedKey("proj_crash"))).toBe(0);
      expect(await redis.zscore(tenantActiveZKey("proj_crash"), d1!.groupId)).toBeNull();
    });

    /** @scenario Disabling the cap restores all parked groups */
    it("drains every parked group back to ready when the cap is set to 0", async () => {
      scripts = new GroupStagingScripts(redis, QUEUE_NAME, { tenantConcurrencyCap: 1 });
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

      scripts = new GroupStagingScripts(redis, QUEUE_NAME, { tenantConcurrencyCap: 0 });
      await scripts.dispatch({ nowMs: 5000, activeTtlSec: 60 });
      expect(await redis.zcard(parkedKey("proj_acme"))).toBe(0);
      expect(await redis.sismember(`${keyPrefix()}parked-tenants`, "proj_acme")).toBe(0);
    });

    /** @scenario Restoring parked groups never exceeds the tenant cap */
    it("unparks no more than (cap - active) groups, so one completion frees exactly one", async () => {
      scripts = new GroupStagingScripts(redis, QUEUE_NAME, { tenantConcurrencyCap: 2 });
      for (let i = 1; i <= 5; i++) {
        await stageOne({
          tenantId: "proj_acme",
          groupSuffix: `g${i}`,
          stagedJobId: `j${i}`,
          dispatchAfterMs: 1000 + i,
        });
      }
      const now = Date.now();
      const d1 = await scripts.dispatch({ nowMs: now, activeTtlSec: 60 });
      await scripts.dispatch({ nowMs: now, activeTtlSec: 60 });
      expect(await redis.zcard(tenantActiveZKey("proj_acme"))).toBe(2);
      expect(await scripts.dispatch({ nowMs: now, activeTtlSec: 60 })).toBeNull();
      expect(await redis.zcard(parkedKey("proj_acme"))).toBe(3);

      await scripts.complete({ groupId: d1!.groupId, stagedJobId: d1!.stagedJobId });
      expect(await redis.zcard(parkedKey("proj_acme"))).toBe(2);
      expect(await redis.zcount(`${keyPrefix()}ready`, "-inf", "3000")).toBe(1);
    });

    /** @scenario Staging a new job for a parked group keeps it parked */
    it("keeps a parked group parked when a new job is staged for it (STAGE respects parked)", async () => {
      scripts = new GroupStagingScripts(redis, QUEUE_NAME, { tenantConcurrencyCap: 1 });
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

      await scripts.stage(makeJob({ groupId: "proj_acme/g2", stagedJobId: "j2b", dispatchAfterMs: 900 }));

      expect(await redis.zscore(`${keyPrefix()}ready`, "proj_acme/g2")).toBeNull();
      expect(await redis.zrange(parkedKey("proj_acme"), 0, -1, "WITHSCORES")).toEqual([
        "proj_acme/g2",
        "900",
      ]);
    });

    /** @scenario A tenant's in-flight slots self-heal after an ungraceful worker death */
    it("self-heals the tenant cap after an ungraceful mass worker death without an operator reset", async () => {
      scripts = new GroupStagingScripts(redis, QUEUE_NAME, { tenantConcurrencyCap: 3 });

      for (let i = 1; i <= 4; i++) {
        await stageOne({
          tenantId: "proj_dead",
          groupSuffix: `g${i}`,
          stagedJobId: `j${i}`,
          dispatchAfterMs: 1000 + i,
        });
      }

      const dispatched: DispatchResult[] = [];
      for (let i = 0; i < 4; i++) {
        const d = await scripts.dispatch({ nowMs: 2000, activeTtlSec: 5 });
        if (d) dispatched.push(d);
      }
      expect(dispatched).toHaveLength(3);
      expect(await tenantLiveCount("proj_dead", 2000)).toBe(3);
      expect(await redis.zcard(parkedKey("proj_dead"))).toBe(1);
      expect(await redis.sismember(`${keyPrefix()}parked-tenants`, "proj_dead")).toBe(1);

      for (const d of dispatched) {
        await redis.del(`${keyPrefix()}group:${d.groupId}:active`);
      }
      expect(await redis.zcard(tenantActiveZKey("proj_dead"))).toBe(3);
      expect(await tenantLiveCount("proj_dead", 8000)).toBe(0);

      const recovered = await scripts.dispatch({ nowMs: 8000, activeTtlSec: 5 });
      expect(recovered).not.toBeNull();
      expect(recovered!.groupId).toBe("proj_dead/g4");
      expect(await redis.zcard(parkedKey("proj_dead"))).toBe(0);
      expect(await tenantLiveCount("proj_dead", 8000)).toBe(1);
    });
  });
});
