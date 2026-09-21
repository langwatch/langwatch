import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupQueueRuntimeDefinition } from "../contracts.ts";
import { GroupQueueError } from "../errors.ts";
import { GroupQueueProcessor } from "../groupQueue.ts";

type TestPayload = { id: string; groupId: string };

const WARNING =
  "Migration preflight stopped waiting for work that had not drained and is starting anyway; the tenants it covers stay held for a later pass, and these counts are for operator triage";

/**
 * The barrier runs before this process consumes anything, so on a fleet
 * booting together nothing drains the work it waits on. It gives up and
 * starts; only a fault still refuses.
 */
describe("GroupQueueProcessor - preflight drain barrier", () => {
  let redis: Redis;
  let queues: GroupQueueProcessor<TestPayload>[];
  let queueName: string;

  beforeAll(() => {
    redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 0,
    });
  });

  beforeEach(() => {
    queues = [];
    queueName = `{test/gqpreflight/${crypto.randomUUID().slice(0, 8)}}`;
  });

  afterEach(async () => {
    await Promise.all(queues.map((q) => q.close().catch(() => {})));
    // Scoped to this suite's own namespace, never flushdb().
    const keys = await redis.keys("{test/gqpreflight/*");
    if (keys.length > 0) await redis.del(...keys);
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await redis.quit();
  });

  function allowListKey(): string {
    return `${queueName}:gq:preflight`;
  }

  function createQueue(): GroupQueueProcessor<TestPayload> {
    const definition: GroupQueueRuntimeDefinition<TestPayload> = {
      name: queueName,
      process: async () => {},
      groupKey: (payload) => payload.groupId,
      identify: (payload) => payload.id,
    };
    const queue = new GroupQueueProcessor<TestPayload>(definition, redis, {
      consumerEnabled: false,
      dispatchGroupAllowListKey: allowListKey(),
      // Zero reaches the deadline branch without waiting it out: the settled
      // check runs first, so a barrier with nothing draining it reads its
      // targets once, finds work outstanding and gives up immediately.
      preflightDrainTimeoutMs: 0,
    });
    queues.push(queue);
    return queue;
  }

  async function targetGroupWithPendingWork(groupId: string): Promise<void> {
    await redis.sadd(allowListKey(), groupId);
    await redis.zadd(`${queueName}:gq:group:${groupId}:jobs`, 1, `job-${groupId}`);
  }

  /** The logger is a private field; the spy sees the log object as written. */
  function spyOnWarn(queue: GroupQueueProcessor<TestPayload>) {
    const logger: { warn: (fields: Record<string, unknown>, message: string) => void } =
      Reflect.get(queue, "logger");
    return vi.spyOn(logger, "warn");
  }

  describe("given preflight work that has not drained by the deadline", () => {
    /** @scenario "Work that never drains leaves its tenants held rather than refusing startup" */
    it("starts rather than refusing, and logs what it stopped waiting for", async () => {
      const queue = createQueue();
      const warnSpy = spyOnWarn(queue);
      await targetGroupWithPendingWork("held-group");

      await expect(queue.waitUntilPreflightIdle()).resolves.toBeUndefined();

      const call = warnSpy.mock.calls.find(([, message]) => message === WARNING);
      expect(call?.[0]).toMatchObject({ queueName, pending: 1, groups: 1, timeoutMs: 0 });
    });
  });

  describe("given preflight work that failed by the deadline", () => {
    /** @scenario "Work that never drains leaves its tenants held rather than refusing startup" */
    it("still refuses to start", async () => {
      const queue = createQueue();
      await targetGroupWithPendingWork("faulted-group");
      await redis.set(`${queueName}:gq:group:faulted-group:error`, "1");

      await expect(queue.waitUntilPreflightIdle()).rejects.toThrow(GroupQueueError);
    });
  });

  describe("given a preflight target blocked by the deadline", () => {
    it("still refuses to start", async () => {
      const queue = createQueue();
      await targetGroupWithPendingWork("blocked-group");
      await redis.sadd(`${queueName}:gq:blocked`, "blocked-group");

      await expect(queue.waitUntilPreflightIdle()).rejects.toThrow(GroupQueueError);
    });
  });
});
