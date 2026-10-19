import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupQueuePolicy, GroupQueueRuntimeDefinition } from "../contracts.ts";
import { dlqGroupKeys, dlqIndexKey } from "../deadLetter.ts";
import { NonRetryableGroupQueueError } from "../errors.ts";
import { GroupQueueProcessor } from "../groupQueue.ts";

type TestPayload = { id: string; groupId: string; value: string };

// Ready scores are validated against the staging clock, so anchor ordinals to a recent timestamp.
const SCORE_BASE_MS = Date.now() - 60 * 60 * 1000;

const payloadsFor = (ids: string[]): TestPayload[] =>
  ids.map((id, index) => ({ id, groupId: "group-a", value: String(SCORE_BASE_MS + index * 1000) }));

/** packages/group-queue/specs/dead-letter-on-exhaustion.feature */
describe("GroupQueueProcessor — dead-letter on exhaustion", () => {
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
    const keys = await redis.keys("{test/gqdlq/*");
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    await redis.quit();
  });

  /** Stages every payload first, then starts the consumer, so the group holds them in order. */
  async function stageThenConsume({
    processFn,
    overrides = {},
    payloads,
    policy,
  }: {
    processFn: (payload: TestPayload) => Promise<void>;
    overrides?: Partial<GroupQueueRuntimeDefinition<TestPayload>>;
    payloads: TestPayload[];
    policy?: GroupQueuePolicy;
  }): Promise<{ keyPrefix: string }> {
    const name = `{test/gqdlq/${crypto.randomUUID().slice(0, 8)}}`;
    const definition: GroupQueueRuntimeDefinition<TestPayload> = {
      name,
      groupKey: (p) => p.groupId,
      identify: (p) => p.id,
      score: (p) => Number(p.value),
      process: processFn,
      ...overrides,
    };
    const producer = new GroupQueueProcessor<TestPayload>(definition, redis, {
      consumerEnabled: false,
    });
    queues.push(producer);
    await producer.sendBatch(payloads);

    const consumer = new GroupQueueProcessor<TestPayload>(definition, redis, { policy });
    queues.push(consumer);
    await consumer.waitUntilReady();
    return { keyPrefix: `${name}:gq:` };
  }

  describe("given a queue whose jobs dead-letter when spent", () => {
    describe("when a job fails non-retryably ahead of a healthy one", () => {
      /** @scenario "A dead-lettering group keeps draining past a failed job" */
      it("runs the healthy job and keeps the failed one in the dead-letter entries", async () => {
        const ran: string[] = [];
        const { keyPrefix } = await stageThenConsume({
          processFn: async (p) => {
            if (p.id === "job-1") throw new NonRetryableGroupQueueError("unscrubbable");
            ran.push(p.id);
          },
          overrides: { onExhausted: () => "dead-letter" },
          payloads: payloadsFor(["job-1", "job-2"]),
        });

        await vi.waitFor(() => expect(ran).toEqual(["job-2"]), { timeout: 10_000, interval: 50 });

        const dlq = dlqGroupKeys({ keyPrefix, groupId: "group-a" });
        expect(await redis.zrange(dlq.jobs, 0, -1)).toEqual(["job-1"]);
        expect(await redis.hexists(dlq.data, "job-1")).toBe(1);
        expect(await redis.hget(dlq.error, "message")).toBe("unscrubbable");
        expect(await redis.smembers(dlqIndexKey(keyPrefix))).toEqual(["group-a"]);
        expect(await redis.smembers(`${keyPrefix}blocked`)).toEqual([]);
      });
    });
  });

  describe("given a queue with no exhaustion outcome declared", () => {
    describe("when a job fails non-retryably ahead of a healthy one", () => {
      /** @scenario "A queue that names no outcome still blocks the group" */
      it("blocks the group with the failed job re-staged and never runs the next", async () => {
        const ran: string[] = [];
        const { keyPrefix } = await stageThenConsume({
          processFn: async (p) => {
            if (p.id === "job-1") throw new NonRetryableGroupQueueError("unscrubbable");
            ran.push(p.id);
          },
          payloads: payloadsFor(["job-1", "job-2"]),
        });

        await vi.waitFor(
          async () => expect(await redis.smembers(`${keyPrefix}blocked`)).toEqual(["group-a"]),
          { timeout: 10_000, interval: 50 },
        );

        expect(ran).toEqual([]);
        expect(await redis.zrange(`${keyPrefix}group:group-a:jobs`, 0, -1)).toEqual([
          "job-1",
          "job-2",
        ]);
        expect(await redis.scard(dlqIndexKey(keyPrefix))).toBe(0);
      });
    });
  });

  describe("given a coalescing queue whose jobs dead-letter when spent", () => {
    describe("when one payload of a batch fails on every attempt", () => {
      /** @scenario "A coalesced batch dead-letters only the payload bisection isolated" */
      it("dead-letters only that payload and runs the rest of the batch", async () => {
        const committed: string[] = [];
        const failIfPoisoned = (ps: TestPayload[]) => {
          if (ps.some((p) => p.id === "b")) throw new Error("poison payload");
          committed.push(...ps.map((p) => p.id));
        };
        const { keyPrefix } = await stageThenConsume({
          processFn: async (p) => failIfPoisoned([p]),
          overrides: {
            processBatch: async (ps) => failIfPoisoned(ps),
            coalesceMaxBatch: () => 10,
            onExhausted: () => "dead-letter",
          },
          payloads: payloadsFor(["a", "b", "c"]),
          // The second failed dispatch quarantines, which spends the job without 25 retries.
          policy: { quarantineFailureThreshold: 1 },
        });

        await vi.waitFor(() => expect(committed).toContain("c"), {
          timeout: 20_000,
          interval: 50,
        });

        const dlq = dlqGroupKeys({ keyPrefix, groupId: "group-a" });
        expect(await redis.zrange(dlq.jobs, 0, -1)).toEqual(["b"]);
        expect(committed).not.toContain("b");
        expect(committed).toContain("a");
        expect(await redis.smembers(`${keyPrefix}blocked`)).toEqual([]);
      });
    });
  });
});
