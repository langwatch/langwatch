import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupQueueRuntimeDefinition } from "../contracts.ts";
import { GroupQueueProcessor } from "../groupQueue.ts";

type TestPayload = {
  id: string;
  groupId: string;
  value: string;
};

// Ready scores are validated against the staging clock, so a bare ordinal is
// rejected as "not a timestamp" and replaced with the staging time. Anchor the
// ordinal to a real, recent timestamp instead: same relative order, and it
// exercises the shape a production score function actually returns.
const SCORE_BASE_MS = Date.now() - 60 * 60 * 1000;
const orderedScore = (n: number): number => SCORE_BASE_MS + n * 1000;

describe("GroupQueueProcessor — group coalescing", () => {
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
    const keys = await redis.keys("{test/coalescing/*");
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    await redis.quit();
  });

  function createQueue(
    processFn: (payload: TestPayload) => Promise<void>,
    overrides: Partial<GroupQueueRuntimeDefinition<TestPayload>> = {},
  ): GroupQueueProcessor<TestPayload> {
    const queue = new GroupQueueProcessor<TestPayload>(
      {
        name: `{test/coalescing/${crypto.randomUUID().slice(0, 8)}}`,
        groupKey: (p) => p.groupId,
        identify: (p) => p.id,
        process: processFn,
        ...overrides,
      },
      redis,
    );
    queues.push(queue);
    return queue;
  }

  const numberedPayloads = (count: number, value?: string): TestPayload[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `j${i}`,
      groupId: "group-a",
      value: value ?? String(i),
    }));

  describe("when a group is backed up", () => {
    /** @scenario A backed-up group is folded in a single batch call */
    it("folds the queued events into a single processBatch call", async () => {
      const batches: TestPayload[][] = [];
      const singles: TestPayload[] = [];
      const queue = createQueue(
        async (p) => {
          singles.push(p);
        },
        {
          processBatch: async (ps) => {
            batches.push(ps);
          },
          coalesceMaxBatch: () => 50,
          score: (p) => orderedScore(Number(p.value)),
        },
      );
      await queue.waitUntilReady();

      await queue.sendBatch(numberedPayloads(10));

      await vi.waitFor(
        () => {
          const total = batches.reduce((n, b) => n + b.length, 0) + singles.length;
          expect(total).toBe(10);
        },
        { timeout: 30000, interval: 50 },
      );

      // Coalescing actually happened: at least one multi-event batch.
      expect(batches.length).toBeGreaterThanOrEqual(1);
      expect(Math.max(...batches.map((b) => b.length))).toBeGreaterThan(1);
      // Every event processed exactly once across batches and singles.
      expect(new Set([...batches.flat(), ...singles].map((p) => p.id)).size).toBe(10);
    });

    it("delivers a coalesced batch in ascending score order", async () => {
      let largest: TestPayload[] = [];
      const queue = createQueue(async () => {}, {
        processBatch: async (ps) => {
          if (ps.length > largest.length) largest = ps;
        },
        coalesceMaxBatch: () => 50,
        score: (p) => orderedScore(Number(p.value)),
      });
      await queue.waitUntilReady();

      // Sent shuffled; the queue must still fold them in score order.
      await queue.sendBatch(
        [4, 2, 0, 3, 1].map((n) => ({ id: `j${n}`, groupId: "group-a", value: String(n) })),
      );

      await vi.waitFor(
        () => {
          expect(largest.length).toBe(5);
        },
        { timeout: 30000, interval: 50 },
      );
      expect(largest.map((p) => Number(p.value))).toEqual([0, 1, 2, 3, 4]);
    });

    /** @scenario Coalescing respects the configured max batch size */
    it("never exceeds coalesceMaxBatch per call", async () => {
      const batches: TestPayload[][] = [];
      const singles: TestPayload[] = [];
      const queue = createQueue(
        async (p) => {
          singles.push(p);
        },
        {
          processBatch: async (ps) => {
            batches.push(ps);
          },
          coalesceMaxBatch: () => 3,
          score: (p) => orderedScore(Number(p.value)),
        },
      );
      await queue.waitUntilReady();

      await queue.sendBatch(numberedPayloads(9));

      await vi.waitFor(
        () => {
          const total = batches.reduce((n, b) => n + b.length, 0) + singles.length;
          expect(total).toBe(9);
        },
        { timeout: 30000, interval: 50 },
      );

      for (const batch of batches) {
        expect(batch.length).toBeLessThanOrEqual(3);
      }
      expect(new Set([...batches.flat(), ...singles].map((p) => p.id)).size).toBe(9);
    });
  });

  describe("when coalescing is disabled with a max batch of one", () => {
    /** @scenario Coalescing is a no-op when disabled */
    it("processes each event individually and never calls processBatch", async () => {
      const batches: TestPayload[][] = [];
      const singles: TestPayload[] = [];
      const queue = createQueue(
        async (p) => {
          singles.push(p);
        },
        {
          processBatch: async (ps) => {
            batches.push(ps);
          },
          coalesceMaxBatch: () => 1,
          score: (p) => orderedScore(Number(p.value)),
        },
      );
      await queue.waitUntilReady();

      await queue.sendBatch(numberedPayloads(5));

      await vi.waitFor(
        () => {
          expect(singles.length).toBe(5);
        },
        { timeout: 30000, interval: 50 },
      );
      expect(batches.length).toBe(0);
    });
  });

  describe("when a coalesced batch fails", () => {
    /** @scenario A failed coalesced batch re-stages its drained siblings */
    it("re-stages drained siblings so none are lost", async () => {
      let attempts = 0;
      const succeeded: TestPayload[] = [];
      const queue = createQueue(
        async (p) => {
          succeeded.push(p);
        },
        {
          processBatch: async (ps) => {
            attempts++;
            if (attempts === 1) {
              throw new Error("simulated batch failure");
            }
            for (const p of ps) succeeded.push(p);
          },
          coalesceMaxBatch: () => 50,
          score: (p) => orderedScore(Number(p.value)),
        },
      );
      await queue.waitUntilReady();

      await queue.sendBatch(numberedPayloads(4));

      // Despite the first batch throwing, every event is eventually processed —
      // the drained siblings were re-staged, not lost. The retry re-stages with
      // a future score and no signal, so the dispatcher only picks it up on its
      // fallback poll; the window must absorb several poll cycles on a
      // CPU-starved runner.
      await vi.waitFor(
        () => {
          expect(new Set(succeeded.map((p) => p.id)).size).toBe(4);
        },
        { timeout: 45000, interval: 100 },
      );
    });
  });

  // The drain is bounded by bytes as well as count. Byte math is asserted at
  // the Lua level elsewhere; here we need only the observable: a burst the
  // count bound alone would fold whole is split by the byte bound, and nothing
  // is lost.
  describe("when a byte budget bounds the batch", () => {
    /** @scenario a batch is bounded by size as well as count */
    it("splits a burst at the byte budget and loses nothing", async () => {
      const batches: TestPayload[][] = [];
      const singles: TestPayload[] = [];
      const queue = createQueue(
        async (p) => {
          singles.push(p);
        },
        {
          processBatch: async (ps) => {
            batches.push(ps);
          },
          coalesceMaxBatch: () => 50,
          coalesceMaxBytes: () => 1500,
          score: (p) => orderedScore(Number(p.id.slice(1))),
        },
      );
      await queue.waitUntilReady();

      await queue.sendBatch(numberedPayloads(6, "x".repeat(500)));

      await vi.waitFor(
        () => {
          const total = batches.reduce((n, b) => n + b.length, 0) + singles.length;
          expect(total).toBe(6);
        },
        { timeout: 30000, interval: 50 },
      );

      // The byte bound bit: the whole burst never collapsed into one batch,
      // even though the count bound alone (50) would have folded all six.
      const maxBatch = batches.length > 0 ? Math.max(...batches.map((b) => b.length)) : 0;
      expect(maxBatch).toBeLessThan(6);
      // ...but a coalesced batch DID form — without this floor the assertion
      // above passes vacuously when nothing coalesces at all.
      expect(maxBatch).toBeGreaterThanOrEqual(2);
      expect(new Set([...batches.flat(), ...singles].map((p) => p.id)).size).toBe(6);
    });

    /** @scenario a single oversized item is appended on its own */
    it("processes an oversized job on its own, coalescing nothing", async () => {
      const batches: TestPayload[][] = [];
      const singles: TestPayload[] = [];
      const queue = createQueue(
        async (p) => {
          singles.push(p);
        },
        {
          processBatch: async (ps) => {
            batches.push(ps);
          },
          coalesceMaxBatch: () => 50,
          // Smaller than any single job's stored size, so every dispatch's own
          // initial byte count already exceeds the budget.
          coalesceMaxBytes: () => 50,
          score: (p) => orderedScore(Number(p.id.slice(1))),
        },
      );
      await queue.waitUntilReady();

      await queue.sendBatch(numberedPayloads(4, "x".repeat(500)));

      await vi.waitFor(
        () => {
          expect(singles.length).toBe(4);
        },
        { timeout: 30000, interval: 50 },
      );
      // No siblings are ever folded, so the batch handler is never called.
      expect(batches.length).toBe(0);
    });
  });
});
