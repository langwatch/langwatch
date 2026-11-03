/**
 * A listed consumer claims from each open run in its own script call; each call numbers its batch
 * slots from one, so claims from two runs must never share a worker slot or a call.
 * Spec: specs/cross-group-batch.feature.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupQueueContext, GroupQueueContextMetadata } from "../contracts.ts";
import { GroupQueueProcessor } from "../groupQueue.ts";

type TestPayload = { id: string; groupId: string };

const SLOTS = 2;
const HOLD_MS = 600;

class TestQueueContext implements GroupQueueContext {
  readonly storage = new AsyncLocalStorage<GroupQueueContextMetadata>();

  capture(): GroupQueueContextMetadata | undefined {
    return this.storage.getStore();
  }

  run<T>(metadata: GroupQueueContextMetadata | undefined, operation: () => Promise<T>): Promise<T> {
    return this.storage.run(metadata ?? {}, operation);
  }
}

describe("GroupQueueProcessor - claims from several listed runs", () => {
  let redis: Redis;
  let queues: GroupQueueProcessor<TestPayload>[];
  let queueName: string;
  let running: number;
  let peak: number;
  let ran: string[];
  let sharedCalls: string[][];

  beforeAll(() => {
    redis = new IORedis(
      process.env.LANGWATCH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? "redis://localhost:6379",
      { maxRetriesPerRequest: 0 },
    );
  });

  beforeEach(() => {
    queues = [];
    running = 0;
    peak = 0;
    ran = [];
    sharedCalls = [];
    queueName = `{test/gqlistedslots/${crypto.randomUUID().slice(0, 8)}}`;
  });

  afterEach(async () => {
    await Promise.all(queues.map((queue) => queue.close().catch(() => {})));
    const keys = await redis.keys("{test/gqlistedslots/*");
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    await redis.quit();
  });

  async function hold({ groupIds }: { groupIds: string[] }): Promise<void> {
    running += groupIds.length;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
    running -= groupIds.length;
    ran.push(...groupIds);
  }

  function createQueue({ consumer }: { consumer: "none" | "listed" }) {
    const queue = new GroupQueueProcessor<TestPayload>(
      {
        name: queueName,
        process: (payload) => hold({ groupIds: [payload.groupId] }),
        processGroups: async (groups) => {
          const groupIds = groups.map((group) => group.payloads[0]?.groupId ?? "");
          sharedCalls.push(groupIds);
          await hold({ groupIds });
        },
        groupBatchRoutes: () => [],
        groupKey: (payload) => payload.groupId,
        identify: (payload) => payload.id,
        score: () => Date.now(),
        options: { globalConcurrency: SLOTS },
      },
      redis,
      {
        consumerEnabled: consumer !== "none",
        context: new TestQueueContext(),
        ...(consumer === "listed" ? { dispatchListed: true } : {}),
      },
    );
    queues.push(queue);
    return queue;
  }

  describe("given three open runs holding one ready group each, of three tenants", () => {
    /** @scenario "Claims from separate listed runs never share a worker slot" */
    it("runs each group alone and never more groups at once than the consumer's slots", async () => {
      const sender = createQueue({ consumer: "none" });
      await sender.waitUntilReady();
      const groupIds = ["tenant-1/a", "tenant-2/b", "tenant-3/c"];
      let sent = 0;
      const runs = groupIds.map((groupId) =>
        sender.runListedWork({
          name: `upgrade-step:test:${groupId.replace("/", "-")}`,
          timeoutMs: 15_000,
          work: async () => {
            await sender.send({ id: groupId, groupId });
            sent += 1;
            return 1;
          },
        }),
      );
      await vi.waitFor(() => expect(sent).toBe(groupIds.length), { timeout: 5_000 });

      await createQueue({ consumer: "listed" }).waitUntilReady();
      await Promise.all(runs);

      expect(sharedCalls).toEqual([]);
      expect(peak).toBeLessThanOrEqual(SLOTS);
      expect(ran.toSorted()).toEqual(groupIds);
    }, 20_000);
  });
});
