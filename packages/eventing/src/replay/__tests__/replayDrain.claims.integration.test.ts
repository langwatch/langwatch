/** The drain and the queue's claim list agree on real Redis (ADR-092). */
import { GroupStagingScripts } from "@langwatch/group-queue/operational";
import IORedis, { type Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EVENT_SOURCING_QUEUE_KEY_NAME, eventSourcingClaimsIndex } from "../replayClaimsIndex.ts";
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
    const groupId = `${tenantId}/state/counter/conversation-1`;
    const scripts = new GroupStagingScripts(redis, EVENT_SOURCING_QUEUE_KEY_NAME);
    await scripts.stage({
      stagedJobId: `${tenantId}-job`,
      groupId,
      dispatchAfterMs: 0,
      dedupId: "",
      dedupTtlMs: 0,
      jobDataJson: "{}",
    });
    let claim = await scripts.dispatch({ nowMs: Date.now() + 1_000, activeTtlSec: 60 });
    while (claim && claim.groupId !== groupId) {
      claim = await scripts.dispatch({ nowMs: Date.now() + 1_000, activeTtlSec: 60 });
    }
    expect(claim?.groupId).toBe(groupId);

    const drain = (maxWaitMs: number) =>
      waitForActiveJobs({
        redis,
        claims: eventSourcingClaimsIndex({ redis, isReady: async () => true }),
        aggregates: [{ tenantId, aggregateType: "conversation", aggregateId: "conversation-1" }],
        projectionName: "counter",
        kind: "state",
        maxWaitMs,
      });

    await expect(drain(500)).rejects.toThrow(/Timed out/);

    await scripts.complete({
      groupId,
      stagedJobId: claim!.stagedJobId,
      claimToken: claim!.claimToken,
    });
    await expect(drain(500)).resolves.toBeUndefined();
  });
});
