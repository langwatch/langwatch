/**
 * A listed run's jobs coalesce exactly as jobs outside a run do; a sibling under another scope
 * never joins the batch. Spec: specs/listed-run-coalescing.feature.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { GroupQueueContext, GroupQueueContextMetadata } from "../contracts.ts";
import { GroupQueueProcessor } from "../groupQueue.ts";

type TestPayload = { id: string; groupId: string; at: number };

const HOUR_AGO_MS = Date.now() - 60 * 60 * 1000;

class TestQueueContext implements GroupQueueContext {
  readonly storage = new AsyncLocalStorage<GroupQueueContextMetadata>();

  capture(): GroupQueueContextMetadata | undefined {
    return this.storage.getStore();
  }

  run<T>(metadata: GroupQueueContextMetadata | undefined, operation: () => Promise<T>): Promise<T> {
    return this.storage.run(metadata ?? {}, operation);
  }
}

describe("GroupQueueProcessor - coalescing on a listed run", () => {
  let redis: Redis;
  let queues: GroupQueueProcessor<TestPayload>[];
  let queueName: string;
  let context: TestQueueContext;
  let singles: string[];
  let batches: string[][];

  beforeAll(() => {
    redis = new IORedis(
      process.env.LANGWATCH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? "redis://localhost:6379",
      { maxRetriesPerRequest: 0 },
    );
  });

  beforeEach(() => {
    queues = [];
    singles = [];
    batches = [];
    queueName = `{test/gqlistedbatch/${crypto.randomUUID().slice(0, 8)}}`;
    context = new TestQueueContext();
  });

  afterEach(async () => {
    await Promise.all(queues.map((queue) => queue.close().catch(() => {})));
    const keys = await redis.keys("{test/gqlistedbatch/*");
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    await redis.quit();
  });

  function createQueue({ listed }: { listed: boolean }): GroupQueueProcessor<TestPayload> {
    const queue = new GroupQueueProcessor<TestPayload>(
      {
        name: queueName,
        process: async (payload) => {
          singles.push(payload.id);
        },
        processBatch: async (payloads) => {
          batches.push(payloads.map((payload) => payload.id));
        },
        coalesceMaxBatch: () => 50,
        groupKey: (payload) => payload.groupId,
        identify: (payload) => payload.id,
        score: (payload) => payload.at,
      },
      redis,
      { consumerEnabled: listed, context, ...(listed ? { dispatchListed: true } : {}) },
    );
    queues.push(queue);
    return queue;
  }

  const runJobs = (count: number): TestPayload[] =>
    Array.from({ length: count }, (_, index) => ({
      id: `run-${index}`,
      groupId: "tenant-1/command/aggregate-1",
      at: Date.now() + index,
    }));

  describe("given a listed run that sends ten jobs to one group in one batch", () => {
    /** @scenario "Jobs a listed run sends to one group run as one batch" */
    it("hands them to the handler in fewer calls than jobs, each job once", async () => {
      const sender = createQueue({ listed: false });
      await sender.waitUntilReady();
      await createQueue({ listed: true }).waitUntilReady();

      await sender.runListedWork({
        name: "upgrade-step:test:coalesce:run-1",
        timeoutMs: 20_000,
        work: () => sender.sendBatch(runJobs(10)),
      });

      const ran = [...singles, ...batches.flat()];
      expect(ran.toSorted()).toEqual(
        runJobs(10)
          .map((job) => job.id)
          .toSorted(),
      );
      expect(singles.length + batches.length).toBeLessThan(10);
      expect(Math.max(...batches.map((batch) => batch.length))).toBeGreaterThan(1);
    }, 30_000);
  });

  describe("given a group holding an older job sent outside any run", () => {
    /** @scenario "A job from outside the run is never folded into the run's batch" */
    it("runs the older job on its own and batches only the run's jobs", async () => {
      const sender = createQueue({ listed: false });
      await sender.waitUntilReady();
      await sender.send({
        id: "outside",
        groupId: "tenant-1/command/aggregate-1",
        at: HOUR_AGO_MS,
      });
      await createQueue({ listed: true }).waitUntilReady();

      await sender.runListedWork({
        name: "upgrade-step:test:coalesce:run-2",
        timeoutMs: 20_000,
        work: () => sender.sendBatch(runJobs(5)),
      });

      expect(singles[0]).toBe("outside");
      expect(batches.flat()).not.toContain("outside");
      const ran = [...singles, ...batches.flat()].filter((id) => id !== "outside");
      expect(ran.toSorted()).toEqual(
        runJobs(5)
          .map((job) => job.id)
          .toSorted(),
      );
    }, 30_000);
  });
});
