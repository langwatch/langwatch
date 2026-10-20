/**
 * A consumer's slots grow while its jobs wait on IO, and the dispatcher claims against the grown
 * count, up to the policy's ceiling, on real Redis. Spec: specs/adaptive-slots.feature.
 */
import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GroupQueueProcessor } from "../groupQueue.ts";

type TestPayload = { id: string; groupId: string };

const CONFIGURED = 2;
const CEILING = 4;
const WAITS_MS = 1_000;

describe("GroupQueueProcessor - adaptive slots", () => {
  let redis: Redis;
  let queues: GroupQueueProcessor<TestPayload>[];
  let queueName: string;

  beforeAll(() => {
    redis = new IORedis(
      process.env.LANGWATCH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? "redis://localhost:6379",
      { maxRetriesPerRequest: 0 },
    );
  });

  beforeEach(() => {
    queues = [];
    queueName = `{test/gqadaptive/${crypto.randomUUID().slice(0, 8)}}`;
  });

  afterEach(async () => {
    await Promise.all(queues.map((queue) => queue.close().catch(() => {})));
    const keys = await redis.keys("{test/gqadaptive/*");
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    await redis.quit();
  });

  describe("given a backlog of jobs that each wait on IO", () => {
    /** @scenario "A consumer whose jobs wait on IO grows its slots up to its ceiling" */
    it("comes to run its ceiling of jobs at once, and never more", async () => {
      let running = 0;
      let peak = 0;
      const done = new Set<string>();
      const queue = new GroupQueueProcessor<TestPayload>(
        {
          name: queueName,
          process: async (payload) => {
            running += 1;
            peak = Math.max(peak, running);
            await new Promise((resolve) => setTimeout(resolve, WAITS_MS));
            running -= 1;
            done.add(payload.id);
          },
          groupKey: (payload) => payload.groupId,
          identify: (payload) => payload.id,
          score: () => Date.now(),
          options: { globalConcurrency: CONFIGURED },
        },
        redis,
        { policy: { adaptiveSlotsCeiling: CEILING } },
      );
      queues.push(queue);
      await queue.waitUntilReady();

      const ids = Array.from({ length: 16 }, (_, index) => `tenant-1/group-${index}`);
      for (const id of ids) await queue.send({ id, groupId: id });

      await vi.waitFor(() => expect(done.size).toBe(ids.length), { timeout: 20_000 });
      expect(peak).toBe(CEILING);
    }, 30_000);
  });
});
