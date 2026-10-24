/** A worker with no handler hands a job back unspent; specs/hand-back-unhandled-job.feature. */

import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupQueueRuntimeDefinition, JobDelivery } from "../contracts.ts";
import { HandBackGroupQueueError } from "../errors.ts";
import { GroupQueueProcessor } from "../groupQueue.ts";

type TestPayload = { id: string; groupId: string };

describe("GroupQueueProcessor - hand-back of a job a worker has no handler for", () => {
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
    // Scoped to this suite's own namespace, never flushdb().
    const keys = await redis.keys("{test/gqhandback/*");
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    await redis.quit();
  });

  function worker({
    name,
    process,
  }: {
    name: string;
    process: (payload: TestPayload, delivery?: JobDelivery) => Promise<void>;
  }): GroupQueueProcessor<TestPayload> {
    const definition: GroupQueueRuntimeDefinition<TestPayload> = {
      name,
      groupKey: (p) => p.groupId,
      identify: (p) => p.id,
      process,
    };
    const queue = new GroupQueueProcessor<TestPayload>(definition, redis);
    queues.push(queue);
    return queue;
  }

  describe("given two workers on one queue, only one of which has the job's handler", () => {
    describe("when the worker without the handler takes the job first", () => {
      /** @scenario "Another worker with the handler runs a handed-back job" */
      it("hands it back and the worker with the handler runs it on its first attempt", async () => {
        const name = `{test/gqhandback/${crypto.randomUUID().slice(0, 8)}}`;
        const keyPrefix = `${name}:gq:`;
        let handedBack = 0;
        const older = worker({
          name,
          process: async () => {
            handedBack += 1;
            throw new HandBackGroupQueueError("no handler registered in this worker");
          },
        });
        await older.waitUntilReady();
        await older.send({ id: "job-1", groupId: "group-a" });
        await vi.waitFor(() => expect(handedBack).toBeGreaterThanOrEqual(1), {
          timeout: 10_000,
          interval: 50,
        });
        // Only the worker that handed the job back knows when it is due again, so left claiming
        // it can win the job back on every retry; paused, the other worker's claim is the next.
        older.pause();

        const ranAt: number[] = [];
        const newer = worker({
          name,
          process: async (_payload, delivery) => {
            ranAt.push(delivery?.attempt ?? 0);
          },
        });
        await newer.waitUntilReady();

        await vi.waitFor(() => expect(ranAt).toEqual([1]), { timeout: 20_000, interval: 50 });
        expect(await redis.smembers(`${keyPrefix}blocked`)).toEqual([]);
        expect(await redis.exists(`${keyPrefix}group:group-a:failstreak`)).toBe(0);
      });
    });
  });
});
