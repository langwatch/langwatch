/**
 * A paused tenant's groups are held OUT of the dispatch scan rather than
 * skipped where they lie: the scan has a bounded budget, so a large paused
 * backlog sitting at the front of ready would exhaust it and starve every
 * other tenant.
 *
 * @see specs/queue-pausing/queue-pausing.feature
 */
import IORedis, { type Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GroupStagingScripts } from "../scripts";

const QUEUE_NAME = "{test/tenant-pause-parking}";

let redis: Redis;
let scripts: GroupStagingScripts;

const keyPrefix = () => `${QUEUE_NAME}:gq:`;
const parkedKey = (tenantId: string) => `${keyPrefix()}parked:${tenantId}`;

function stage({
  groupId,
  stagedJobId,
  dispatchAfterMs,
}: {
  groupId: string;
  stagedJobId: string;
  dispatchAfterMs: number;
}) {
  return scripts.stage({
    stagedJobId,
    groupId,
    dispatchAfterMs,
    dedupId: "",
    dedupTtlMs: 0,
    jobDataJson: JSON.stringify({ hello: "world" }),
    shouldExtend: true,
    shouldReplace: true,
  });
}

async function deleteSuiteKeys(): Promise<void> {
  const keys = await redis.keys(`${QUEUE_NAME}*`);
  if (keys.length > 0) await redis.del(...keys);
}

beforeAll(() => {
  redis = new IORedis(
    process.env.LANGWATCH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? "redis://localhost:6379",
    {
      maxRetriesPerRequest: 0,
    },
  );
});

beforeEach(async () => {
  await deleteSuiteKeys();
  scripts = new GroupStagingScripts(redis, QUEUE_NAME);
});

afterAll(async () => {
  await deleteSuiteKeys();
  await redis.quit();
});

describe("given a paused tenant whose groups sit at the front of ready", () => {
  describe("when the dispatcher runs", () => {
    /** @scenario A paused tenant's backlog does not block other tenants */
    it("dispatches the tenant behind them and parks the paused ones out of the scan", async () => {
      for (let i = 0; i < 5; i++) {
        await stage({
          groupId: `project_A/command/recordSpan/trace:${i}`,
          stagedJobId: `paused-${i}`,
          dispatchAfterMs: 100 + i,
        });
      }
      // Staged later, so it sits BEHIND the paused tenant's groups in ready.
      await stage({
        groupId: "project_B/command/recordSpan/trace:b",
        stagedJobId: "other-tenant",
        dispatchAfterMs: 200,
      });
      await scripts.addPauseKey("tenant:project_A");

      const dispatched = await scripts.dispatch({ nowMs: 300, activeTtlSec: 60 });

      expect(dispatched?.groupId).toBe("project_B/command/recordSpan/trace:b");
      expect(await redis.zcard(parkedKey("project_A"))).toBe(5);
      const ready = await redis.zrange(`${keyPrefix()}ready`, 0, -1);
      expect(ready.some((groupId) => groupId.startsWith("project_A/"))).toBe(false);
    });
  });

  describe("when the dispatcher reconcile runs while the tenant is still paused", () => {
    /** @scenario A still-paused tenant is not restored by the reconcile */
    it("leaves the groups parked", async () => {
      await stage({
        groupId: "project_A/command/recordSpan/trace:xyz",
        stagedJobId: "j1",
        dispatchAfterMs: 100,
      });
      await scripts.addPauseKey("tenant:project_A");

      expect(await scripts.dispatch({ nowMs: 200, activeTtlSec: 60 })).toBeNull();
      expect(await redis.zcard(parkedKey("project_A"))).toBe(1);

      // Past the reconcile gate: the sweep runs, and refuses to restore a
      // tenant that is still paused.
      expect(await scripts.dispatch({ nowMs: 2_300, activeTtlSec: 60 })).toBeNull();
      expect(await redis.zcard(parkedKey("project_A"))).toBe(1);
    });
  });
});
