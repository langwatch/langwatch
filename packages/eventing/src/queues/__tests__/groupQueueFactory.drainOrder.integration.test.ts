/**
 * A job still draining at shutdown must be able to stage its fan-out through the
 * same queue. Needs Redis at REDIS_URL (default localhost:6379).
 * @see specs/background/queue-drain-send-gate.feature
 */

import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createEventingGroupQueueFactory } from "../groupQueueFactory.ts";
import type { EventSourcedQueueProcessor } from "../queue.types.ts";

const KEY_NAMESPACE = "test/eqdrain";

describe("createEventingGroupQueueFactory close", () => {
  let redis: Redis;
  const queues: EventSourcedQueueProcessor<Record<string, unknown>>[] = [];

  beforeAll(() => {
    redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 0,
    });
  });

  afterEach(async () => {
    await Promise.all(queues.splice(0).map((queue) => queue.close().catch(() => {})));
    // Scoped to this suite's own namespace, never flushdb().
    const keys = await redis.keys(`{${KEY_NAMESPACE}/*`);
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    await redis.quit();
  });

  describe("given a consumer holding a job that is still running", () => {
    describe("when the queue closes and the job then stages downstream work on it", () => {
      /** @scenario A job still draining at shutdown stages its fan-out through the same queue */
      it("stages the work rather than refusing it", async () => {
        let started = false;
        let release: () => void = () => {};
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        let fanOut: "staged" | Error | undefined;

        const queue = createEventingGroupQueueFactory({ dependencies: { redis } })({
          name: `${KEY_NAMESPACE}/${crypto.randomUUID().slice(0, 8)}`,
          groupKey: (payload) => String(payload.groupId),
          process: async (payload) => {
            if (payload.kind !== "first") return;
            started = true;
            await held;
            try {
              await queue.send({ kind: "fan-out", groupId: "downstream" });
              fanOut = "staged";
            } catch (error) {
              fanOut = error instanceof Error ? error : new Error(String(error));
            }
          },
        });
        queues.push(queue);
        queue.start?.();
        await queue.waitUntilReady();

        await queue.send({ kind: "first", groupId: "upstream" });
        await vi.waitFor(() => expect(started).toBe(true), { timeout: 10_000, interval: 25 });

        const closing = queue.close();
        // Long enough for any part of the close that does not wait on the job to finish.
        await new Promise((resolve) => setTimeout(resolve, 200));
        release();
        await closing;

        expect(fanOut).toBe("staged");
      });
    });
  });
});
