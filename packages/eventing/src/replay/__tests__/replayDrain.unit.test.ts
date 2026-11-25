import { memoryRedisDouble, redisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { afterEach, describe, expect, it, vi } from "vitest";

import { waitForActiveJobs } from "../replayDrain.ts";

describe("replay drain", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("scans the tenant-scoped state queue until its active group drains", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    const scan = vi
      .fn()
      .mockResolvedValueOnce([
        "0",
        ["{event-sourcing/jobs}:gq:group:project-1/state/conversationState/conversation-1:active"],
      ])
      .mockResolvedValue(["0", []]);
    const redis = redisDouble({ scan });

    const drained = waitForActiveJobs({
      redis,
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

    await vi.advanceTimersByTimeAsync(200);
    await drained;

    expect(scan).toHaveBeenNthCalledWith(
      1,
      "0",
      "MATCH",
      "{event-sourcing/jobs}:gq:group:project-1/state/conversationState/*:active",
      "COUNT",
      500,
    );
    // The second poll also asks for a claimed record a dead worker left behind.
    expect(scan).toHaveBeenNthCalledWith(
      3,
      "0",
      "MATCH",
      "{event-sourcing/jobs}:gq:group:project-1/state/conversationState/*:claimed",
      "COUNT",
      500,
    );
    expect(scan).toHaveBeenCalledTimes(3);
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
    it("treats a scanned state group as in flight until the record is gone", async () => {
      const drained = await waitsUntilClaimedRecordGoes({
        claimedKey: `${GROUP_PREFIX}/state/conversationState/conversation-1:claimed`,
        projectionName: "conversationState",
        kind: "state",
      });
      expect(drained).toEqual({ whileClaimed: false, afterRecordGoes: true });
    });
  });
});
