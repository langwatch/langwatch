/**
 * A consumer that runs only listed groups, beside a large backlog: the work a
 * listed send causes is listed too, and nothing from the backlog is taken.
 * Spec: specs/upgrade/background-steps.feature.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupQueueContext, GroupQueueContextMetadata } from "../contracts.ts";
import { GroupQueueProcessor } from "../groupQueue.ts";

type TestPayload = { id: string; groupId: string; followUp?: string };

const BACKLOG = 2_000;
const HOUR_AGO_MS = Date.now() - 60 * 60 * 1000;

/** The process's log context, as the worker carries it onto a job and back. */
class TestQueueContext implements GroupQueueContext {
  readonly storage = new AsyncLocalStorage<GroupQueueContextMetadata>();

  capture(): GroupQueueContextMetadata | undefined {
    return this.storage.getStore();
  }

  run<T>(metadata: GroupQueueContextMetadata | undefined, operation: () => Promise<T>): Promise<T> {
    return this.storage.run(metadata ?? {}, operation);
  }
}

describe("GroupQueueProcessor - allow-listed dispatch beside a backlog", () => {
  let redis: Redis;
  let queues: GroupQueueProcessor<TestPayload>[];
  let queueName: string;
  let context: TestQueueContext;

  beforeAll(() => {
    redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 0,
    });
  });

  beforeEach(() => {
    queues = [];
    queueName = `{test/gqlisted/${crypto.randomUUID().slice(0, 8)}}`;
    context = new TestQueueContext();
  });

  afterEach(async () => {
    await Promise.all(queues.map((queue) => queue.close().catch(() => {})));
    // Scoped to this suite's own namespace, never flushdb().
    const keys = await redis.keys("{test/gqlisted/*");
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    await redis.quit();
  });

  function listKey(): string {
    return `${queueName}:gq:upgrade-steps`;
  }

  function createQueue({
    consumer,
    process = async () => {},
  }: {
    consumer: boolean;
    process?: (payload: TestPayload) => Promise<void>;
  }): GroupQueueProcessor<TestPayload> {
    const queue = new GroupQueueProcessor<TestPayload>(
      {
        name: queueName,
        process,
        groupKey: (payload) => payload.groupId,
        identify: (payload) => payload.id,
        score: (payload) => (payload.id.startsWith("backlog-") ? HOUR_AGO_MS : Date.now()),
      },
      redis,
      {
        consumerEnabled: consumer,
        context,
        ...(consumer ? { dispatchGroupAllowListKey: listKey() } : {}),
      },
    );
    queues.push(queue);
    return queue;
  }

  describe("given a large backlog of older groups and one listed send", () => {
    /** @scenario "Queue work an upgrade step sends runs ahead of a backlog" */
    it("runs the listed job and the job it causes, and takes nothing from the backlog", async () => {
      const producer = createQueue({ consumer: false });
      await producer.waitUntilReady();
      await producer.sendBatch(
        Array.from({ length: BACKLOG }, (_, index) => ({
          id: `backlog-${index}`,
          groupId: `tenant-${index % 50}/bulk/${index}`,
        })),
      );

      await context.run({ queueDispatchScopeKey: listKey() }, () =>
        producer.send({ id: "step-command", groupId: "tenant-1/command/a", followUp: "reaction" }),
      );

      const processed: string[] = [];
      const consumer = createQueue({
        consumer: true,
        process: async (payload) => {
          processed.push(payload.id);
          if (payload.followUp) {
            await producer.send({ id: payload.followUp, groupId: "tenant-1/subscriber/a" });
          }
        },
      });
      await consumer.waitUntilReady();

      await vi.waitFor(() => expect(processed).toEqual(["step-command", "reaction"]), {
        timeout: 20_000,
        interval: 50,
      });
      expect(processed.some((id) => id.startsWith("backlog-"))).toBe(false);
      expect(await redis.zcard(`${queueName}:gq:ready`)).toBeGreaterThanOrEqual(BACKLOG);
    }, 30_000);
  });
});
