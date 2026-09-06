import IORedis, { type Redis } from "ioredis";
import { register } from "prom-client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GroupQueueProcessor } from "../groupQueue.ts";

type TestPayload = {
  id: string;
  groupId: string;
  value: string;
};

const SCORE_BASE_MS = Date.now() - 60 * 60 * 1000;

async function readyScoreImplausibleCount(queueName: string): Promise<number> {
  const metric = await register.getSingleMetric("gq_ready_score_implausible_total")?.get();
  return metric?.values.find((v) => v.labels.queue_name === queueName)?.value ?? 0;
}

describe("GroupQueueProcessor — ready score integrity", () => {
  let redis: Redis;
  let queues: GroupQueueProcessor<TestPayload>[];

  beforeAll(() => {
    redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 0,
    });
  });

  beforeEach(() => {
    queues = [];
  });

  afterEach(async () => {
    await Promise.all(queues.map((q) => q.close().catch(() => {})));
    const keys = await redis.keys("{test/readyscore/*");
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    await redis.quit();
  });

  describe("when a producer's score function returns a value that is not a timestamp", () => {
    // The end-to-end version of the defect, and the one assertion the unit
    // tests cannot make: that what is WRITTEN to Redis is the resolved score,
    // and that the resolved score takes its place in the real dispatch order.
    // A test that recomputed the expected score in its own body would keep
    // passing if `send` stopped calling the guard altogether; this one reads
    // the staged score back out of the group's own jobs zset.
    /** @scenario a job staged with an unusable score dispatches behind one that occurred earlier */
    it("stages it at the current time and dispatches it behind a genuinely older job", async () => {
      const processedOrder: string[] = [];
      let releaseBlocker: (() => void) | undefined;
      const blockerHeld = new Promise<void>((resolve) => {
        releaseBlocker = resolve;
      });

      const queueName = `{test/readyscore/${crypto.randomUUID().slice(0, 8)}}`;
      const scores: Record<string, number> = {
        blocker: SCORE_BASE_MS,
        older: Date.now() - 60_000,
        broken: 0,
      };
      const queue = new GroupQueueProcessor<TestPayload>(
        {
          name: queueName,
          groupKey: (p) => p.groupId,
          identify: (p) => p.id,
          score: (p) => scores[p.id] ?? 0,
          process: async (p) => {
            if (p.id === "blocker") await blockerHeld;
            processedOrder.push(p.id);
          },
        },
        redis,
      );
      queues.push(queue);
      await queue.waitUntilReady();

      // The blocker is staged first and carries the lowest score, so it leads
      // the group and holds it while the two jobs behind it stay staged long
      // enough to read their scores back out of Redis.
      await queue.send({ id: "blocker", groupId: "g", value: "b" });

      const stagedAtLeast = Date.now();
      await queue.send({ id: "broken", groupId: "g", value: "x" });
      await queue.send({ id: "older", groupId: "g", value: "y" });

      try {
        const jobsKey = `${queueName}:gq:group:g:jobs`;
        await vi.waitFor(
          async () => {
            expect(await redis.zcard(jobsKey)).toBeGreaterThanOrEqual(2);
          },
          { timeout: 5000, interval: 50 },
        );

        // The broken score reached Redis as a real timestamp, not as 0.
        const staged = await redis.zrange(jobsKey, 0, -1, "WITHSCORES");
        const brokenScore = Number(staged[staged.findIndex((m) => m.includes("broken")) + 1]);
        expect(brokenScore).toBeGreaterThanOrEqual(stagedAtLeast);
        expect(brokenScore).toBeLessThanOrEqual(Date.now() + 1000);
      } finally {
        releaseBlocker?.();
      }

      await vi.waitFor(
        () => {
          expect(processedOrder).toHaveLength(3);
        },
        { timeout: 30000, interval: 50 },
      );

      // Rescored to now, so it sorts BEHIND the job that really did occur a
      // minute ago. Staged at 0 it would have led the group for ever.
      expect(processedOrder).toEqual(["blocker", "older", "broken"]);

      // Exactly one: the counter reports PRODUCERS, so only the supplied score
      // the queue refused registers. The two accepted scores do not.
      expect(await readyScoreImplausibleCount(queueName)).toBe(1);
    });
  });
});
