/**
 * The two ordering promises the framework makes, driven against Redis: work in
 * one group is serialized in staging order, and two groups make progress
 * without waiting for one another.
 */
import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupQueueRuntimeDefinition } from "../contracts";
import { GroupQueueProcessor } from "../groupQueue";

type TestPayload = { id: string; groupId: string };

describe("GroupQueueProcessor ordering", () => {
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
    await Promise.all(queues.map((queue) => queue.close().catch(() => {})));
    const keys = await redis.keys("{test/order/*");
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    await redis.quit();
  });

  function createQueue(
    processFn: (payload: TestPayload) => Promise<void>,
    options?: { delay?: number; dedupKey?: (payload: TestPayload) => string },
  ): { queue: GroupQueueProcessor<TestPayload> } {
    const definition: GroupQueueRuntimeDefinition<TestPayload> = {
      name: `{test/order/${crypto.randomUUID().slice(0, 8)}}`,
      groupKey: (payload) => payload.groupId,
      identify: (payload) => payload.id,
      process: processFn,
      ...(options?.delay === undefined ? {} : { delay: options.delay }),
      ...(options?.dedupKey === undefined ? {} : { deduplication: { makeId: options.dedupKey } }),
    };
    const queue = new GroupQueueProcessor<TestPayload>(definition, redis, {
      consumerEnabled: true,
    });
    queues.push(queue);
    return { queue };
  }

  describe("given two jobs staged for the same group", () => {
    /** @scenario "A GroupQueueConsumer preserves order within a group" */
    it("finishes the first job before the second handler starts", async () => {
      const events: string[] = [];
      let releaseFirst = (): void => {};
      const firstHeld = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });

      const { queue } = createQueue(async (payload) => {
        events.push(`start:${payload.id}`);
        if (payload.id === "first") await firstHeld;
        events.push(`end:${payload.id}`);
      });
      await queue.waitUntilReady();

      await queue.send({ id: "first", groupId: "group-a" });
      await queue.send({ id: "second", groupId: "group-a" });

      await vi.waitFor(() => expect(events).toEqual(["start:first"]), {
        timeout: 5000,
        interval: 25,
      });
      releaseFirst();

      await vi.waitFor(
        () => expect(events).toEqual(["start:first", "end:first", "start:second", "end:second"]),
        { timeout: 5000, interval: 25 },
      );
    });
  });

  describe("given jobs staged for two different groups", () => {
    /** @scenario "Independent groups may make progress concurrently" */
    it("lets the second group finish while the first is still held", async () => {
      const events: string[] = [];
      let releaseBlocked = (): void => {};
      const blockedHeld = new Promise<void>((resolve) => {
        releaseBlocked = resolve;
      });

      const { queue } = createQueue(async (payload) => {
        events.push(`start:${payload.id}`);
        if (payload.groupId === "group-blocked") await blockedHeld;
        events.push(`end:${payload.id}`);
      });
      await queue.waitUntilReady();

      await queue.send({ id: "blocked", groupId: "group-blocked" });
      await queue.send({ id: "free", groupId: "group-free" });

      await vi.waitFor(() => expect(events).toContain("end:free"), {
        timeout: 5000,
        interval: 25,
      });
      expect(events).not.toContain("end:blocked");

      releaseBlocked();
      await vi.waitFor(() => expect(events).toContain("end:blocked"), {
        timeout: 5000,
        interval: 25,
      });
    });
  });

  describe("given a delayed queue that deduplicates on a key", () => {
    /** @scenario "Delayed squashed job processes exactly once within timeout" */
    it("runs the second send's payload exactly once", async () => {
      const handled: TestPayload[] = [];
      const { queue } = createQueue(
        async (payload) => {
          handled.push(payload);
        },
        { delay: 200, dedupKey: (payload) => payload.groupId },
      );
      await queue.waitUntilReady();

      await queue.send({ id: "first", groupId: "squashed" });
      await queue.send({ id: "second", groupId: "squashed" });

      await vi.waitFor(() => expect(handled).toHaveLength(1), { timeout: 9000, interval: 25 });
      expect(handled[0]?.id).toBe("second");
    });
  });
});
