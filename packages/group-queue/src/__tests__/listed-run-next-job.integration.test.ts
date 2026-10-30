/**
 * A listed run's group gets its next job soon after a job outside the run completes, and a
 * success clears the group's retry chain. Spec: specs/listed-run-scan-cost.feature.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupQueueContext, GroupQueueContextMetadata } from "../contracts.ts";
import { GroupQueueProcessor } from "../groupQueue.ts";

type TestPayload = { id: string; groupId: string; takesMs?: number };

class TestQueueContext implements GroupQueueContext {
  readonly storage = new AsyncLocalStorage<GroupQueueContextMetadata>();

  capture(): GroupQueueContextMetadata | undefined {
    return this.storage.getStore();
  }

  run<T>(metadata: GroupQueueContextMetadata | undefined, operation: () => Promise<T>): Promise<T> {
    return this.storage.run(metadata ?? {}, operation);
  }
}

describe("GroupQueueProcessor - a listed run's next job", () => {
  let redis: Redis;
  let queues: GroupQueueProcessor<TestPayload>[];
  let queueName: string;
  let context: TestQueueContext;
  let started: Map<string, number>;
  let finished: Map<string, number>;

  beforeAll(() => {
    redis = new IORedis(
      process.env.LANGWATCH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? "redis://localhost:6379",
      { maxRetriesPerRequest: 0 },
    );
  });

  beforeEach(() => {
    queues = [];
    started = new Map();
    finished = new Map();
    queueName = `{test/gqlistednext/${crypto.randomUUID().slice(0, 8)}}`;
    context = new TestQueueContext();
  });

  afterEach(async () => {
    await Promise.all(queues.map((queue) => queue.close().catch(() => {})));
    const keys = await redis.keys("{test/gqlistednext/*");
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    await redis.quit();
  });

  function createQueue({ consumer }: { consumer: "none" | "listed" | "main" }) {
    const queue = new GroupQueueProcessor<TestPayload>(
      {
        name: queueName,
        process: async (payload) => {
          started.set(payload.id, Date.now());
          if (payload.takesMs) await new Promise((resolve) => setTimeout(resolve, payload.takesMs));
          finished.set(payload.id, Date.now());
        },
        groupKey: (payload) => payload.groupId,
        identify: (payload) => payload.id,
        score: () => Date.now(),
      },
      redis,
      {
        consumerEnabled: consumer !== "none",
        context,
        ...(consumer === "listed" ? { dispatchListed: true } : {}),
      },
    );
    queues.push(queue);
    return queue;
  }

  describe("given a listed run's group holding a job sent outside the run", () => {
    /** @scenario "A listed run's group gets its next job about a second after a job sent outside the run" */
    it("claims the run's job about a second after the outside job, not at the idle poll", async () => {
      const sender = createQueue({ consumer: "none" });
      await sender.waitUntilReady();
      await sender.send({ id: "outside", groupId: "tenant-1/shared", takesMs: 200 });
      await createQueue({ consumer: "listed" }).waitUntilReady();

      await sender.runListedWork({
        name: "upgrade-step:test:next-job",
        timeoutMs: 15_000,
        work: async () => {
          await sender.send({ id: "listed", groupId: "tenant-1/shared" });
          return { sent: 1 };
        },
      });

      const outsideDone = finished.get("outside");
      const listedStarted = started.get("listed");
      expect(outsideDone).toBeDefined();
      expect(listedStarted).toBeDefined();
      expect(listedStarted! - outsideDone!).toBeLessThan(1_500);
    }, 20_000);
  });

  describe("given a group with a recorded failure streak and retry attempt", () => {
    /** @scenario "A job that succeeds clears its group's failure streak and retry attempt" */
    it("clears both when the group's next job succeeds", async () => {
      const groupKey = `${queueName}:gq:group:tenant-1/chain`;
      await redis.set(`${groupKey}:failstreak`, "3");
      await redis.set(`${groupKey}:attempt`, "2");
      const queue = createQueue({ consumer: "main" });
      await queue.waitUntilReady();

      await queue.send({ id: "succeeds", groupId: "tenant-1/chain" });

      await vi.waitFor(() => expect(finished.has("succeeds")).toBe(true), { timeout: 10_000 });
      await vi.waitFor(
        async () =>
          expect(await redis.exists(`${groupKey}:failstreak`, `${groupKey}:attempt`)).toBe(0),
        { timeout: 5_000 },
      );
    }, 20_000);
  });
});
