import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupQueueRuntimeDefinition, JobDelivery } from "../contracts.ts";
import { NonRetryableGroupQueueError } from "../errors.ts";
import { GroupQueueProcessor } from "../groupQueue.ts";
import { DEFAULT_BISECTION_SPLITS_PER_DISPATCH } from "../scripts.ts";

type TestPayload = {
  id: string;
  groupId: string;
  value: string;
};

// Ready scores are validated against the staging clock, so a bare ordinal is
// rejected as "not a timestamp" and replaced with the staging time — which
// would silently turn every ordering assertion into one about arrival order.
// Anchor the ordinal to a real, recent timestamp instead.
const SCORE_BASE_MS = Date.now() - 60 * 60 * 1000;
const orderedScore = (n: number): number => SCORE_BASE_MS + n * 1000;

/**
 * The batch sizes a bisection produces for one dispatch of `root` payloads,
 * against a handler that accepts at most `maxWorkable` of them per call.
 *
 * The rules, which are the bisector's contract: a batch the handler refuses is
 * split into its ceiling and floor halves, a batch it accepts is a leaf, and
 * the walk is depth-first with the left half before the right.
 */
function bisectionDescent({ root, maxWorkable }: { root: number; maxWorkable: number }): number[] {
  if (root <= maxWorkable) return [root];
  const left = Math.ceil(root / 2);
  return [
    root,
    ...bisectionDescent({ root: left, maxWorkable }),
    ...bisectionDescent({ root: root - left, maxWorkable }),
  ];
}

/**
 * Reads a recorded sequence of handler batch sizes as the dispatches it is made
 * of: `roots` is the size each dispatch started from, and `expected` is the
 * sequence those roots should have produced. Two values rather than one verdict
 * keeps a coalescing change from reading as a bisection bug.
 */
function readDispatchRoots({ sizes, maxWorkable }: { sizes: number[]; maxWorkable: number }): {
  roots: number[];
  expected: number[];
} {
  const roots: number[] = [];
  const expected: number[] = [];
  while (expected.length < sizes.length) {
    const root = sizes[expected.length]!;
    roots.push(root);
    expected.push(...bisectionDescent({ root, maxWorkable }));
  }
  return { roots, expected };
}

type BisectingQueue = {
  processBatchBisecting: (args: {
    entries: { payload: TestPayload; stagedJobId: string }[];
    attempt: number;
    routingLabels: Record<string, string>;
    span: never;
  }) => Promise<void>;
};

const ROUTING_LABELS = {
  queue_name: "q",
  pipeline_name: "p",
  job_type: "t",
  job_name: "n",
};

const FAKE_SPAN = { addEvent: () => {}, setAttribute: () => {} } as never;

describe("GroupQueueProcessor — batch bisection", () => {
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
    // Scoped to this suite's hash-tagged namespace — never a global flushall,
    // which would race with parallel integration suites on the shared Redis.
    const keys = await redis.keys("{test/bisect/*");
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    await redis.quit();
  });

  function createQueue(
    processFn: (payload: TestPayload) => Promise<void>,
    overrides: Partial<GroupQueueRuntimeDefinition<TestPayload>> = {},
    options: { policy?: { bisectionSplitBudget?: number } } = {},
  ): GroupQueueProcessor<TestPayload> {
    const definition: GroupQueueRuntimeDefinition<TestPayload> = {
      name: `{test/bisect/${crypto.randomUUID().slice(0, 8)}}`,
      groupKey: (p) => p.groupId,
      identify: (p) => p.id,
      process: processFn,
      ...overrides,
    };
    const queue = new GroupQueueProcessor<TestPayload>(definition, redis, options);
    queues.push(queue);
    return queue;
  }

  /**
   * Stages a whole group through a producer-only processor, then starts the
   * consumer that dispatches it. Every payload is therefore staged AND past due
   * before a dispatcher exists to look at the group — otherwise a consumer that
   * wakes inside the millisecond spread coalesces a PREFIX of the group, and a
   * test about ONE coalesced batch gets two smaller ones instead.
   */
  async function stageThenConsume({
    processFn,
    overrides,
    payloads,
  }: {
    processFn: (payload: TestPayload) => Promise<void>;
    overrides: Partial<GroupQueueRuntimeDefinition<TestPayload>>;
    payloads: TestPayload[];
  }): Promise<GroupQueueProcessor<TestPayload>> {
    const name = `{test/bisect/${crypto.randomUUID().slice(0, 8)}}`;
    const producer = new GroupQueueProcessor<TestPayload>(
      {
        name,
        groupKey: (p) => p.groupId,
        identify: (p) => p.id,
        process: processFn,
        ...overrides,
      },
      redis,
      { consumerEnabled: false },
    );
    queues.push(producer);
    await producer.sendBatch(payloads);

    const consumer = createQueue(processFn, { ...overrides, name });
    await consumer.waitUntilReady();
    return consumer;
  }

  const orderedPayloads = (count: number): TestPayload[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `j${i}`,
      groupId: "group-a",
      value: String(orderedScore(i) / 1000),
    }));

  describe("when one payload in a coalesced batch is unprocessable", () => {
    /** @scenario Payloads ahead of an unprocessable one still commit */
    it("commits every payload ahead of it and narrows the failure to it alone", async () => {
      // Payloads AFTER the offender deliberately do not commit: the fold
      // derives fields from arrival order, so applying j6 while j5 is
      // unresolved would leave a silent gap.
      const POISON = "j5";
      const attempted: TestPayload[][] = [];
      // An ARRAY, not a set: a set cannot tell "committed once" from
      // "committed twice", and the second is the thing worth watching.
      const committed: string[] = [];

      await stageThenConsume({
        processFn: async (p) => {
          if (p.id === POISON) throw new Error("unprocessable payload");
          committed.push(p.id);
        },
        overrides: {
          processBatch: async (ps) => {
            attempted.push(ps);
            if (ps.some((p) => p.id === POISON)) {
              throw new Error("unprocessable payload");
            }
            for (const p of ps) committed.push(p.id);
          },
          coalesceMaxBatch: () => 50,
          score: (p) => Number(p.value) * 1000,
        },
        payloads: orderedPayloads(8),
      });

      const HEALTHY_PREFIX = ["j0", "j1", "j2", "j3", "j4"] as const;

      // j0..j4 commit despite sharing a batch with the offender. Without
      // bisection the whole batch fails together and NONE of them apply.
      await vi.waitFor(
        () => {
          expect([...new Set(committed)].sort()).toEqual(HEALTHY_PREFIX);
        },
        { timeout: 30000, interval: 50 },
      );
      expect(committed).not.toContain(POISON);

      // No payload is applied more often than its peers: the prefix always
      // commits as a unit, so equal counts hold however many times the group
      // is redelivered, while a payload applied one extra time breaks equality.
      const counts = HEALTHY_PREFIX.map((id) => committed.filter((c) => c === id).length);
      expect(new Set(counts).size).toBe(1);

      // The split actually narrowed to the offender rather than retrying the
      // batch whole: some attempt isolated it on its own.
      const isolated = attempted.filter((b) => b.length === 1 && b[0]?.id === POISON);
      expect(isolated.length).toBeGreaterThanOrEqual(1);
    });

    /** @scenario Each half of a split stays in arrival order */
    it("keeps each half in arrival order while splitting", async () => {
      const POISON = "j6";
      const attempted: TestPayload[][] = [];

      await stageThenConsume({
        processFn: async (p) => {
          if (p.id === POISON) throw new Error("unprocessable payload");
        },
        overrides: {
          processBatch: async (ps) => {
            attempted.push(ps);
            if (ps.some((p) => p.id === POISON)) {
              throw new Error("unprocessable payload");
            }
          },
          coalesceMaxBatch: () => 50,
          score: (p) => Number(p.value) * 1000,
        },
        payloads: orderedPayloads(8),
      });

      await vi.waitFor(
        () => {
          expect(attempted.some((b) => b.length === 1 && b[0]?.id === POISON)).toBe(true);
        },
        { timeout: 30000, interval: 50 },
      );

      // A fold derives fields from arrival order, so every sub-batch a split
      // produces must still be ascending and contiguous in the ORIGINAL
      // sequence — never a reshuffle or an interleave.
      for (const batch of attempted) {
        const indices = batch.map((p) => Number(p.id.slice(1)));
        expect(indices).toEqual([...indices].sort((a, b) => a - b));
        for (let i = 1; i < indices.length; i++) {
          expect(indices[i]! - indices[i - 1]!).toBe(1);
        }
      }
    });
  });

  describe("when payloads arrive out of order and the batch is bisected", () => {
    /** @scenario A split descent emits in the queue's order */
    it("still processes every payload in the queue's order, across sub-batches", async () => {
      // The contiguity check above cannot see the order the sub-batches RUN
      // in — a descent that took the right half first would satisfy it while
      // folding later events before earlier ones. Every payload shares one
      // score, so `sendBatch`'s positional tiebreak decides the order and a
      // bisector keyed on the id rather than on the queue's sequence is caught.
      const MAX_WORKABLE = 2;
      const processedInOrder: number[] = [];
      const attemptedSizes: number[] = [];

      const sendOrder = [5, 2, 7, 0, 4, 1, 6, 3];
      await stageThenConsume({
        processFn: async (p) => {
          processedInOrder.push(Number(p.id.slice(1)));
        },
        overrides: {
          processBatch: async (ps) => {
            attemptedSizes.push(ps.length);
            if (ps.length > MAX_WORKABLE) {
              throw new Error("batch exceeded the downstream budget");
            }
            for (const p of ps) processedInOrder.push(Number(p.id.slice(1)));
          },
          coalesceMaxBatch: () => 50,
          score: (p) => Number(p.value),
        },
        payloads: sendOrder.map((i) => ({
          id: `j${i}`,
          groupId: "group-a",
          value: String(orderedScore(0)),
        })),
      });

      // At-LEAST-8, not exactly 8: an over-delivery would never satisfy an
      // exact-length wait, so the bug would surface as an opaque timeout
      // instead of the array diff below.
      await vi.waitFor(
        () => {
          expect(processedInOrder.length).toBeGreaterThanOrEqual(8);
        },
        { timeout: 30000, interval: 50 },
      );

      // Guard against the test going vacuous: it only says anything about
      // bisection if a batch too large to process was actually split.
      expect(Math.max(...attemptedSizes)).toBeGreaterThan(MAX_WORKABLE);
      expect(processedInOrder).toEqual(sendOrder);
    });
  });

  describe("when a coalesced batch fails only because it is too large", () => {
    /** @scenario A batch too large for the handler converges by halving */
    it("halves it until it fits and commits every payload once", async () => {
      const MAX_WORKABLE = 2;
      const seen: string[] = [];
      const sizes: number[] = [];
      let inFlight = 0;
      let maxConcurrent = 0;

      await stageThenConsume({
        processFn: async (p) => {
          seen.push(p.id);
        },
        overrides: {
          processBatch: async (ps) => {
            sizes.push(ps.length);
            inFlight += 1;
            maxConcurrent = Math.max(maxConcurrent, inFlight);
            // Yield so a concurrent sibling call would overlap here and be
            // caught by maxConcurrent, rather than being hidden by a handler
            // that never awaits.
            await new Promise((resolve) => setTimeout(resolve, 5));
            inFlight -= 1;
            // Models a size-driven downstream limit: nothing is wrong with any
            // individual payload, the batch is simply too big for one pass.
            if (ps.length > MAX_WORKABLE) {
              throw new Error("batch exceeded the downstream budget");
            }
            for (const p of ps) seen.push(p.id);
          },
          coalesceMaxBatch: () => 50,
          score: (p) => Number(p.value) * 1000,
        },
        payloads: orderedPayloads(8),
      });

      await vi.waitFor(
        () => {
          expect(new Set(seen).size).toBe(8);
        },
        { timeout: 30000, interval: 50 },
      );

      // Converged by construction rather than by a retry happening to
      // re-assemble a smaller batch — and without re-applying a payload that
      // already succeeded inside this dispatch.
      expect(seen.length).toBe(8);

      const { roots, expected } = readDispatchRoots({ sizes, maxWorkable: MAX_WORKABLE });

      // Every handler call is accounted for by a descent that halves,
      // depth-first, until each leaf fits. That rules out one-at-a-time
      // retries, halves attempted out of order, and a descent that gives up
      // above the size the handler accepts.
      expect(sizes).toEqual(expected);
      expect(roots).toEqual([8]);
      // Sequential, not merely ordered: no batch ever started while another
      // was still running.
      expect(maxConcurrent).toBe(1);
    });
  });

  describe("when a coalesced batch fails non-retryably", () => {
    /** @scenario A non-retryable failure is never split */
    it("fails fast without splitting", async () => {
      const attempts: number[] = [];

      await stageThenConsume({
        processFn: async () => {},
        overrides: {
          processBatch: async (ps) => {
            attempts.push(ps.length);
            // The failure decision says non-retryable, so the batch must not
            // be split: it would fail identically at every size, and bisecting
            // only multiplies work before the same verdict.
            throw new NonRetryableGroupQueueError("not retryable");
          },
          coalesceMaxBatch: () => 50,
          score: (p) => Number(p.value) * 1000,
        },
        payloads: orderedPayloads(8),
      });

      await vi.waitFor(
        () => {
          expect(attempts.length).toBeGreaterThan(0);
        },
        { timeout: 30000, interval: 50 },
      );

      // Give any split a chance to appear before asserting none did.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(attempts.every((n) => n === attempts[0])).toBe(true);
      expect(Math.min(...attempts)).toBeGreaterThan(1);
    });
  });

  describe("when the split budget is set to zero", () => {
    /** @scenario Setting the split budget to zero disables bisection */
    it("never splits, restoring the pre-bisection behaviour", async () => {
      const sizes: number[] = [];
      const queue = createQueue(
        async () => {},
        {
          processBatch: async (ps) => {
            sizes.push(ps.length);
            throw new Error("retryable");
          },
          coalesceMaxBatch: () => 8,
        },
        { policy: { bisectionSplitBudget: 0 } },
      );
      await queue.waitUntilReady();

      const entries = Array.from({ length: 4 }, (_, i) => ({
        payload: { id: `j${i}`, groupId: "group-a", value: String(i) },
        stagedJobId: `job-${i}`,
      }));

      await expect(
        (queue as unknown as BisectingQueue).processBatchBisecting({
          entries,
          attempt: 1,
          routingLabels: ROUTING_LABELS,
          span: FAKE_SPAN,
        }),
      ).rejects.toThrow("retryable");

      // One call, the whole batch, no descent.
      expect(sizes).toEqual([4]);
    });
  });

  describe("when the root of a bisected batch commits and then fails", () => {
    // Driven through the bisector directly: this is about which delivery flags
    // the descent emits, and staged dispatch adds timing noise that has nothing
    // to do with the contract.
    /** @scenario Sub-batches after the first commit are marked as continuations */
    it("marks the sub-batches as continuations so their commits extend rather than replace", async () => {
      const deliveries: (JobDelivery | undefined)[] = [];
      let rootFailed = false;

      const queue = createQueue(async () => {}, {
        processBatch: async (ps, delivery) => {
          deliveries.push(delivery);
          // The post-store window: the handler COMMITS and only then throws.
          // The commit is the part that matters — a later sub-batch that
          // replaces the applied set erases what this call recorded.
          if (!rootFailed && ps.length > 1) {
            rootFailed = true;
            throw new Error("subscriber failed after the fold was stored");
          }
        },
        coalesceMaxBatch: () => 8,
      });
      await queue.waitUntilReady();

      const entries = Array.from({ length: 4 }, (_, i) => ({
        payload: { id: `j${i}`, groupId: "group-a", value: String(i) },
        stagedJobId: `job-${i}`,
      }));

      await (queue as unknown as BisectingQueue).processBatchBisecting({
        entries,
        attempt: 1,
        routingLabels: ROUTING_LABELS,
        span: FAKE_SPAN,
      });

      // The root is a fresh delivery; every call the split produces after it
      // must be a continuation, because the root already wrote.
      expect(deliveries[0]?.isContinuation).toBeUndefined();
      expect(deliveries.length).toBeGreaterThan(1);
      expect(deliveries.slice(1).every((d) => d?.isContinuation === true)).toBe(true);
    });
  });

  describe("when a batch degrades toward singletons", () => {
    // Driven through the bisector directly rather than via staged dispatch:
    // how large a root the drain assembles varies with staging timing, and this
    // contract — bounded work per locked attempt — must hold for any shape.
    /** @scenario Splitting is bounded within one locked attempt */
    it("stops splitting at the budget and rethrows to the retry path", async () => {
      const sizes: number[] = [];
      const queue = createQueue(async () => {}, {
        processBatch: async (ps) => {
          sizes.push(ps.length);
          // Only singletons fit: without a budget this walks the entire tree —
          // 127 calls for 64 payloads — inside one locked attempt.
          if (ps.length > 1) {
            throw new Error("only singletons fit");
          }
        },
        coalesceMaxBatch: () => 64,
      });
      await queue.waitUntilReady();

      const entries = Array.from({ length: 64 }, (_, i) => ({
        payload: { id: `j${i}`, groupId: "group-a", value: String(i) },
        stagedJobId: `job-${i}`,
      }));

      await expect(
        (queue as unknown as BisectingQueue).processBatchBisecting({
          entries,
          attempt: 1,
          routingLabels: ROUTING_LABELS,
          span: FAKE_SPAN,
        }),
      ).rejects.toThrow("only singletons fit");

      // Splits are the calls that failed with more than one payload; the budget
      // caps them. Total calls stay far below the 127-call full walk, and the
      // throw above is the yield itself: the dispatch fails to the normal
      // restage/backoff machinery instead of finishing the walk under the lock.
      const splits = sizes.filter((n) => n > 1).length;
      expect(splits).toBeLessThanOrEqual(DEFAULT_BISECTION_SPLITS_PER_DISPATCH + 1);
      expect(sizes.length).toBeLessThan(80);
      expect(sizes.length).toBeGreaterThan(5);
    });
  });
});
