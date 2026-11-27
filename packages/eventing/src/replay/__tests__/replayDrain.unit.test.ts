import { memoryRedisDouble, redisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReplayClaimsIndex } from "../replayClaimsIndex.ts";
import { waitForActiveJobs } from "../replayDrain.ts";

/** A claims index listing `groups` until each is released; records every question asked. */
function claimsIndexHolding(groups: string[], { ready = true }: { ready?: boolean } = {}) {
  const held = new Set(groups);
  const asked: { tenantId: string; groupIdPrefix: string }[] = [];
  return {
    asked,
    release: (groupId: string) => held.delete(groupId),
    isReady: async () => ready,
    claimedGroups: async (question: { tenantId: string; groupIdPrefix: string }) => {
      asked.push(question);
      return [...held].filter((groupId) => groupId.startsWith(question.groupIdPrefix));
    },
  } satisfies ReplayClaimsIndex & Record<string, unknown>;
}

describe("replay drain", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** @scenario "A replay drain asks the queue for a tenant's claimed groups instead of walking Redis" */
  it("asks the queue for the tenant's claimed state groups until the group drains, never scanning", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const scan = vi.fn().mockResolvedValue(["0", []]);
    const claims = claimsIndexHolding(["project-1/state/conversationState/conversation-1"]);

    const drained = waitForActiveJobs({
      redis: redisDouble({ scan }),
      claims,
      aggregates: [
        {
          tenantId: "project-1",
          aggregateType: "langy_conversation",
          aggregateId: "conversation-1",
        },
      ],
      projectionName: "conversationState",
      kind: "state",
      maxWaitMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(0);
    claims.release("project-1/state/conversationState/conversation-1");
    await vi.advanceTimersByTimeAsync(200);
    await drained;

    expect(claims.asked).toEqual([
      { tenantId: "project-1", groupIdPrefix: "project-1/state/conversationState/" },
      { tenantId: "project-1", groupIdPrefix: "project-1/state/conversationState/" },
    ]);
    expect(scan).not.toHaveBeenCalled();
  });

  /** @scenario "A replay drain refuses an index that is not ready" */
  it("fails closed with a named code when the claims index is not ready", async () => {
    const scan = vi.fn().mockResolvedValue(["0", []]);

    const drained = waitForActiveJobs({
      redis: redisDouble({ scan }),
      claims: claimsIndexHolding([], { ready: false }),
      aggregates: [{ tenantId: "project-1", aggregateType: "trace", aggregateId: "trace-1" }],
      projectionName: "spanAnalytics",
      kind: "map",
      maxWaitMs: 1_000,
    });

    await expect(drained).rejects.toMatchObject({ code: "replay_claims_index_not_ready" });
    expect(scan).not.toHaveBeenCalled();
  });

  describe("given a group a worker that died left a claimed record for, with no active key", () => {
    const GROUP_PREFIX = "{event-sourcing/jobs}:gq:group:project-1";
    const aggregates = [
      { tenantId: "project-1", aggregateType: "langy_conversation", aggregateId: "conversation-1" },
    ];

    function redisHolding(claimedKey: string) {
      const redis = memoryRedisDouble();
      return { redis, seed: () => redis.hset(claimedKey, "token", "1000.1") };
    }

    /** The queue's view of the same record: listed while the claimed key exists. */
    function claimsOver({
      redis,
      claimedKey,
    }: {
      redis: ReturnType<typeof memoryRedisDouble>;
      claimedKey: string;
    }): ReplayClaimsIndex {
      const groupId = claimedKey.slice(
        "{event-sourcing/jobs}:gq:group:".length,
        -":claimed".length,
      );
      return {
        isReady: async () => true,
        claimedGroups: async ({ groupIdPrefix }) =>
          (await redis.hget(claimedKey, "token")) !== null && groupId.startsWith(groupIdPrefix)
            ? [groupId]
            : [],
      };
    }

    async function waitsUntilClaimedRecordGoes({
      claimedKey,
      projectionName,
      kind,
    }: {
      claimedKey: string;
      projectionName: string;
      kind: "fold" | "state";
    }): Promise<{ whileClaimed: boolean; afterRecordGoes: boolean }> {
      vi.useFakeTimers();
      const { redis, seed } = redisHolding(claimedKey);
      await seed();
      let settled = false;
      const drained = waitForActiveJobs({
        redis,
        claims: claimsOver({ redis, claimedKey }),
        aggregates,
        projectionName,
        kind,
        maxWaitMs: 5_000,
      }).then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(600);
      const whileClaimed = settled;

      await redis.del(claimedKey);
      await vi.advanceTimersByTimeAsync(400);
      await drained;
      return { whileClaimed, afterRecordGoes: settled };
    }

    /** @scenario "A projection replay waits for a group holding a claimed record" */
    it("treats a fold group as in flight until the record is gone", async () => {
      const drained = await waitsUntilClaimedRecordGoes({
        claimedKey: `${GROUP_PREFIX}/fold/conversationFold/langy_conversation:conversation-1:claimed`,
        projectionName: "conversationFold",
        kind: "fold",
      });
      expect(drained).toEqual({ whileClaimed: false, afterRecordGoes: true });
    });

    /** @scenario "A projection replay waits for a group holding a claimed record" */
    it("treats a listed state group as in flight until the record is gone", async () => {
      const drained = await waitsUntilClaimedRecordGoes({
        claimedKey: `${GROUP_PREFIX}/state/conversationState/conversation-1:claimed`,
        projectionName: "conversationState",
        kind: "state",
      });
      expect(drained).toEqual({ whileClaimed: false, afterRecordGoes: true });
    });
  });
});
