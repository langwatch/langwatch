/**
 * A listed run's record holds only its outstanding groups: finished groups leave the set, the
 * baselines and the candidates, new work brings a group back, and closing deletes every key.
 * Spec: specs/listed-run-memory.feature.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { GroupQueueContext, GroupQueueContextMetadata } from "../contracts.ts";
import { GroupQueueError, NonRetryableGroupQueueError } from "../errors.ts";
import { GroupQueueProcessor } from "../groupQueue.ts";

type TestPayload = { id: string; groupId: string; fails?: boolean; takesMs?: number };

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

async function refusalOf(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe("GroupQueueProcessor - a listed run's record", () => {
  let redis: Redis;
  let queues: GroupQueueProcessor<TestPayload>[];
  let queueName: string;
  let context: TestQueueContext;
  let processed: string[];
  let processedCount: number;

  beforeAll(() => {
    redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 0,
    });
  });

  beforeEach(() => {
    queues = [];
    processed = [];
    processedCount = 0;
    queueName = `{test/gqlistmem/${crypto.randomUUID().slice(0, 8)}}`;
    context = new TestQueueContext();
  });

  afterEach(async () => {
    await Promise.all(queues.map((queue) => queue.close().catch(() => {})));
    // Scoped to this suite's own namespace, never flushdb().
    const keys = await redis.keys("{test/gqlistmem/*");
    for (let start = 0; start < keys.length; start += 1_000) {
      await redis.del(...keys.slice(start, start + 1_000));
    }
  });

  afterAll(async () => {
    await redis.quit();
  });

  function createQueue({ listed }: { listed: boolean }): GroupQueueProcessor<TestPayload> {
    const queue: GroupQueueProcessor<TestPayload> = new GroupQueueProcessor<TestPayload>(
      {
        name: queueName,
        process: async (payload) => {
          if (payload.fails) throw new NonRetryableGroupQueueError(`${payload.id} refused`);
          if (payload.takesMs) await new Promise((resolve) => setTimeout(resolve, payload.takesMs));
          processedCount++;
          if (processedCount <= 100) processed.push(payload.id);
        },
        groupKey: (payload) => payload.groupId,
        identify: (payload) => payload.id,
        score: () => Date.now(),
        options: { globalConcurrency: 200 },
      },
      redis,
      { consumerEnabled: listed, context, ...(listed ? { dispatchListed: true } : {}) },
    );
    queues.push(queue);
    return queue;
  }

  async function startQueues(): Promise<GroupQueueProcessor<TestPayload>> {
    const sender = createQueue({ listed: false });
    await sender.waitUntilReady();
    await createQueue({ listed: true }).waitUntilReady();
    return sender;
  }

  /** How many groups each of the run's per-group keys holds right now. */
  async function recordSizes(
    listKey: string,
  ): Promise<{ groups: number; baselines: number; candidates: number }> {
    const [groups, baselines, candidates] = await Promise.all([
      redis.scard(listKey),
      redis.hlen(`${listKey}:baseline`),
      redis.zcard(`${listKey}:candidates`),
    ]);
    return { groups, baselines, candidates };
  }

  async function isRecorded({
    listKey,
    groupId,
  }: {
    listKey: string;
    groupId: string;
  }): Promise<boolean[]> {
    const [inSet, inBaseline, score] = await Promise.all([
      redis.sismember(listKey, groupId),
      redis.hexists(`${listKey}:baseline`, groupId),
      redis.zscore(`${listKey}:candidates`, groupId),
    ]);
    return [inSet === 1, inBaseline === 1, score !== null];
  }

  async function remainingKeys(listKey: string): Promise<number> {
    const suffixes = ["", ":baseline", ":candidates", ":registrations", ":live"];
    const counts = await Promise.all(suffixes.map((suffix) => redis.exists(`${listKey}${suffix}`)));
    const open = await redis.zscore(`${queueName}:gq:listed`, listKey);
    return counts.reduce((total, count) => total + count, 0) + (open === null ? 0 : 1);
  }

  describe("given a run over 100,000 groups that each finish", () => {
    /** @scenario "A listed run over a hundred thousand groups keeps only its outstanding groups" */
    it("never holds more groups than its outstanding jobs, settles, and leaves no key behind", async () => {
      const sender = await startQueues();
      const name = "upgrade-step:memory:run-1";
      const listKey = `${queueName}:gq:listed:${name}`;
      const groups = 100_000;
      const pageSize = 1_000;
      const maxOutstanding = 500;
      let peak = 0;

      await sender.runListedWork({
        name,
        timeoutMs: 60_000,
        work: async (list) => {
          for (let start = 0; start < groups; start += pageSize) {
            await sender.sendBatch(
              Array.from({ length: pageSize }, (_, offset) => ({
                id: `row-${start + offset}`,
                groupId: `tenant-${(start + offset) % 97}/command/${start + offset}`,
              })),
            );
            await list?.waitForRoom({ maxOutstanding });
            const sizes = await recordSizes(listKey);
            peak = Math.max(peak, sizes.groups, sizes.baselines, sizes.candidates);
          }
          await list?.waitForRoom({ maxOutstanding: 0 });
          expect(await recordSizes(listKey)).toEqual({ groups: 0, baselines: 0, candidates: 0 });
        },
      });

      expect(peak).toBeGreaterThan(0);
      expect(peak).toBeLessThanOrEqual(maxOutstanding);
      expect(processedCount).toBe(groups);
      expect(await remainingKeys(listKey)).toBe(0);
    }, 600_000);
  });

  describe("given a run whose group finished and was forgotten", () => {
    /** @scenario "A group that gets new work after it finished is waited on again" */
    it("records the group again when it gets new work and returns only once that work ran", async () => {
      const sender = await startQueues();
      const name = "upgrade-step:memory:again";
      const listKey = `${queueName}:gq:listed:${name}`;
      const groupId = "tenant-1/command/again";
      let forgotten: boolean[] = [];
      let recordedAgain: boolean[] = [];

      await sender.runListedWork({
        name,
        timeoutMs: 20_000,
        work: async (list) => {
          await sender.send({ id: "first", groupId });
          await list?.waitForRoom({ maxOutstanding: 0 });
          forgotten = await isRecorded({ listKey, groupId });
          await sender.send({ id: "second", groupId, takesMs: 500 });
          recordedAgain = await isRecorded({ listKey, groupId });
        },
      });

      expect(forgotten).toEqual([false, false, false]);
      expect(recordedAgain).toEqual([true, true, true]);
      expect(processed).toEqual(["first", "second"]);
      expect(await remainingKeys(listKey)).toBe(0);
    }, 30_000);

    /** @scenario "A forgotten group that fails on new work still fails the run" */
    it("refuses the run naming the group when its new work fails", async () => {
      const sender = await startQueues();
      const name = "upgrade-step:memory:fails";
      const listKey = `${queueName}:gq:listed:${name}`;
      const groupId = "tenant-2/command/fails-later";

      const refusal = await refusalOf(
        sender.runListedWork({
          name,
          timeoutMs: 20_000,
          work: async (list) => {
            await sender.send({ id: "fine", groupId });
            await list?.waitForRoom({ maxOutstanding: 0 });
            expect(await isRecorded({ listKey, groupId })).toEqual([false, false, false]);
            await sender.send({ id: "broken", groupId, fails: true });
          },
        }),
      );

      expect(refusal).toBeInstanceOf(GroupQueueError);
      expect(refusal).toMatchObject({ operation: "runListedWork" });
      expect(String((refusal as Error).message)).toContain(groupId);
      expect(processed).toEqual(["fine"]);
      expect(await remainingKeys(listKey)).toBe(0);
    }, 30_000);
  });
});
