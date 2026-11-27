/** The drain and the queue's claim list agree on real Redis (ADR-092). */
import { readTenantClaimedGroups } from "@langwatch/group-queue";
import { GroupStagingScripts } from "@langwatch/group-queue/operational";
import IORedis, { type Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ReplayClaimsIndex } from "../replayClaimsIndex.ts";
import { waitForActiveJobs } from "../replayDrain.ts";

let redis: Redis;

beforeAll(() => {
  redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: 0,
  });
});

afterAll(async () => {
  await redis.quit();
});

describe("given the event-sourcing queue has claimed a state projection's group", () => {
  /** @scenario "A replay drain on real Redis waits for a group the queue claimed" */
  it("waits while the group is claimed and finishes once it completes", async () => {
    const tenantId = `drain-${crypto.randomUUID().slice(0, 8)}`;
    // A queue of this test's own, so dispatch never claims another suite's group.
    const queueName = `{test/drain-${crypto.randomUUID().slice(0, 8)}}`;
    const groupId = `${tenantId}/state/counter/conversation-1`;
    const scripts = new GroupStagingScripts(redis, queueName);
    const claims: ReplayClaimsIndex = {
      isReady: async () => true,
      claimedGroups: ({ tenantId: tenant, groupIdPrefix }) =>
        readTenantClaimedGroups({ redis, queueName, tenantId: tenant, groupIdPrefix }),
    };
    await scripts.stage({
      stagedJobId: `${tenantId}-job`,
      groupId,
      dispatchAfterMs: 0,
      dedupId: "",
      dedupTtlMs: 0,
      jobDataJson: "{}",
    });
    const claim = await scripts.dispatch({ nowMs: Date.now() + 1_000, activeTtlSec: 60 });
    expect(claim?.groupId).toBe(groupId);

    const drain = (maxWaitMs: number) =>
      waitForActiveJobs({
        redis,
        claims,
        aggregates: [{ tenantId, aggregateType: "conversation", aggregateId: "conversation-1" }],
        projectionName: "counter",
        kind: "state",
        maxWaitMs,
      });

    let completed = false;
    try {
      await expect(drain(500)).rejects.toThrow(/Timed out/);
      await scripts.complete({
        groupId,
        stagedJobId: claim!.stagedJobId,
        claimToken: claim!.claimToken,
      });
      completed = true;
      await expect(drain(500)).resolves.toBeUndefined();
    } finally {
      if (!completed && claim) {
        await scripts.complete({
          groupId,
          stagedJobId: claim.stagedJobId,
          claimToken: claim.claimToken,
        });
      }
      const keys = await redis.keys(`${queueName}*`);
      if (keys.length > 0) await redis.del(...keys);
    }
  });
});
