import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupQueueRuntimeDefinition } from "../contracts.ts";
import { GroupQueueError } from "../errors.ts";
import { GroupQueueProcessor } from "../groupQueue.ts";

type TestPayload = { id: string; groupId: string };

const WARNING =
  "Migration preflight stopped waiting for work that had not drained and is starting anyway; the tenants it covers stay held for a later pass, and these groups are for operator triage";

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
      expect(call?.[0]).toMatchObject({
        queueName,
        pending: 1,
        stillWorking: "held-group",
        timeoutMs: 0,
      });
    });
  });

  describe("given preflight work that failed by the deadline", () => {
    /** @scenario "Work that never drains leaves its tenants held rather than refusing startup" */
    it("still refuses to start", async () => {
      const queue = createQueue();
      await targetGroupWithPendingWork("faulted-group");
      await redis.hset(
        `${queueName}:gq:group:faulted-group:error`,
        "message",
        "boom",
        "timestamp",
        "1",
      );

      await expect(queue.waitUntilPreflightIdle()).rejects.toThrow("failed: faulted-group");
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

  describe("given a group that was already blocked when the preflight adopted it", () => {
    /** @scenario "A group wedged before the preflight does not refuse startup" */
    it("settles past it and leaves it exactly as wedged", async () => {
      const processed: string[] = [];
      const queue = new GroupQueueProcessor<TestPayload>(
        {
          name: queueName,
          process: async (payload) => {
            processed.push(payload.groupId);
          },
          groupKey: (payload) => payload.groupId,
          identify: (payload) => payload.id,
        },
        redis,
        { dispatchGroupAllowListKey: allowListKey() },
      );
      queues.push(queue);
      await redis.sadd(`${queueName}:gq:blocked`, "wedged");
      await redis.hset(`${queueName}:gq:group:wedged:error`, "message", "old", "timestamp", "1");
      await redis.zadd(`${queueName}:gq:group:wedged:jobs`, 1, "stale-job");

      await queue.registerPreflightGroups(() => ["wedged"]);
      await queue.send({ id: "owned", groupId: "owned" });

      await expect(queue.waitUntilPreflightIdle()).resolves.toBeUndefined();
      expect(processed).toEqual(["owned"]);
      expect(await redis.sismember(`${queueName}:gq:blocked`, "wedged")).toBe(1);
      expect(await redis.zcard(`${queueName}:gq:group:wedged:jobs`)).toBe(1);
    });
  });

  describe("given a group the preflight adopted clean", () => {
    it("refuses, naming it, when the group fails under the preflight", async () => {
      const queue = createQueue();
      await queue.registerPreflightGroups(() => ["doomed"]);
      await redis.hset(`${queueName}:gq:group:doomed:error`, "message", "boom", "timestamp", "99");

      await expect(queue.waitUntilPreflightIdle()).rejects.toThrow("failed: doomed");
    });

    it("tells a stale error key from a failure under the preflight on the same group", async () => {
      const queue = createQueue();
      const errorKey = `${queueName}:gq:group:stale:error`;
      await redis.hset(errorKey, "message", "old", "timestamp", "1");
      await queue.registerPreflightGroups(() => ["stale"]);

      await expect(queue.waitUntilPreflightIdle()).resolves.toBeUndefined();

      await redis.hset(errorKey, "message", "new", "timestamp", "2");
      await expect(queue.waitUntilPreflightIdle()).rejects.toThrow("failed: stale");
    });
  });
});
