import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Redis } from "ioredis";
import {
  startTestContainers,
  stopTestContainers,
  getTestRedisConnection,
} from "../../../__tests__/integration/testContainers";
import { GroupQueueProcessor } from "../groupQueue";
import { InMemoryObjectStore } from "./blobTestDoubles";
import type { EventSourcedQueueDefinition } from "../../queue.types";

// Skip when running without testcontainers (unit-only test runs)
const hasTestcontainers = !!(
  process.env.TEST_CLICKHOUSE_URL ||
  process.env.CI_CLICKHOUSE_URL ||
  process.env.REDIS_URL ||
  process.env.CI_REDIS_URL
);

type TestPayload = {
  id: string;
  groupId: string;
  value: string;
};

function createQueueDefinition(
  overrides: Partial<EventSourcedQueueDefinition<TestPayload>> & {
    process: (payload: TestPayload) => Promise<void>;
  },
): EventSourcedQueueDefinition<TestPayload> {
  return {
    name: `{test/gq/${crypto.randomUUID().slice(0, 8)}}`,
    groupKey: (p) => p.groupId,
    ...overrides,
  };
}

describe.skipIf(!hasTestcontainers)(
  "GroupQueueProcessor - Orchestration",
  () => {
    let redis: Redis;
    let queues: GroupQueueProcessor<TestPayload>[];

    beforeAll(async () => {
      await startTestContainers();
      redis = getTestRedisConnection()!;
    });

    beforeEach(() => {
      queues = [];
    });

    afterEach(async () => {
      // Close all queues created during the test
      await Promise.all(
        queues.map((q) => q.close().catch(() => {})),
      );
      await redis.flushall();
    });

    afterAll(async () => {
      await stopTestContainers();
    });

    function createQueue(
      processFn: (payload: TestPayload) => Promise<void>,
      overrides?: Partial<EventSourcedQueueDefinition<TestPayload>>,
      options?: { objectStore?: InMemoryObjectStore },
    ): GroupQueueProcessor<TestPayload> {
      const queue = new GroupQueueProcessor<TestPayload>(
        createQueueDefinition({ process: processFn, ...overrides }),
        redis,
        options?.objectStore
          ? {
              objectStoreFor: () => options.objectStore!,
              resolveStorageDestination: async () => ({
                kind: "s3",
                bucket: "test-bucket",
              }),
            }
          : undefined,
      );
      queues.push(queue);
      return queue;
    }

    describe("send()", () => {
      describe("when a job is sent", () => {
        it("stages and processes the job with correct payload", async () => {
          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          processed.mockResolvedValue(undefined);

          const queue = createQueue(processed);
          await queue.waitUntilReady();

          const payload: TestPayload = {
            id: "job-1",
            groupId: "group-a",
            value: "hello",
          };

          await queue.send(payload);

          // Wait for the job to be processed
          await vi.waitFor(
            () => {
              expect(processed).toHaveBeenCalledTimes(1);
            },
            { timeout: 5000, interval: 50 },
          );

          const receivedPayload = processed.mock.calls[0]![0];
          expect(receivedPayload.id).toBe("job-1");
          expect(receivedPayload.groupId).toBe("group-a");
          expect(receivedPayload.value).toBe("hello");
        });
      });

      describe("when deduplication is configured", () => {
        it("deduplicates jobs with the same dedup key within TTL window", async () => {
          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          // Add a small delay to ensure both sends happen before processing
          processed.mockImplementation(
            () => new Promise((resolve) => setTimeout(resolve, 100)),
          );

          const queue = createQueue(processed, {
            deduplication: {
              makeId: (p) => `${p.groupId}:${p.id}`,
              ttlMs: 5000,
            },
          });
          await queue.waitUntilReady();

          // Send the same logical job twice rapidly
          await queue.send({
            id: "dedup-1",
            groupId: "group-a",
            value: "first",
          });
          await queue.send({
            id: "dedup-1",
            groupId: "group-a",
            value: "second",
          });

          // Wait for processing
          await vi.waitFor(
            () => {
              expect(processed).toHaveBeenCalledTimes(1);
            },
            { timeout: 5000, interval: 50 },
          );

          // Should have received the second (replaced) payload
          const receivedPayload = processed.mock.calls[0]![0];
          expect(receivedPayload.value).toBe("second");

          // Wait a bit more to confirm no second call arrives
          await new Promise((resolve) => setTimeout(resolve, 500));
          expect(processed).toHaveBeenCalledTimes(1);
        });
      });
    });

    describe("close()", () => {
      describe("when close is called after processing", () => {
        it("resolves and stops accepting new jobs", async () => {
          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          processed.mockResolvedValue(undefined);

          const queue = createQueue(processed);
          await queue.waitUntilReady();

          await queue.send({
            id: "job-close",
            groupId: "group-a",
            value: "before-close",
          });

          await vi.waitFor(
            () => {
              expect(processed).toHaveBeenCalledTimes(1);
            },
            { timeout: 5000, interval: 50 },
          );

          // Remove from tracked queues so afterEach doesn't double-close
          queues = queues.filter((q) => q !== queue);
          await expect(queue.close()).resolves.toBeUndefined();

          // Sending after close throws
          await expect(
            queue.send({
              id: "job-after-close",
              groupId: "group-a",
              value: "after-close",
            }),
          ).rejects.toThrow(/shutdown/i);
        });
      });
    });

    describe("waitUntilReady()", () => {
      describe("when called on a new queue", () => {
        it("resolves immediately", async () => {
          const queue = createQueue(vi.fn().mockResolvedValue(undefined));

          await expect(queue.waitUntilReady()).resolves.toBeUndefined();
        });
      });
    });

    describe("envelope blob offload", () => {
      describe("when a payload exceeds the inline ceiling", () => {
        it("stores the body under a blob key, delivers it intact, and leaves the blob to its lease", async () => {
          const queueName = `{test/gq/blob-${crypto.randomUUID().slice(0, 8)}}`;
          const blobKeysDuringProcessing: string[] = [];
          const processed = vi.fn(async (_payload: TestPayload) => {
            blobKeysDuringProcessing.push(
              ...(await redis.keys(`${queueName}:gq:blob:*`)),
            );
          });

          const queue = createQueue(
            processed,
            { name: queueName },
            { objectStore: new InMemoryObjectStore() },
          );
          await queue.waitUntilReady();

          const bigValue = "z".repeat(64 * 1024);
          await queue.send({
            id: "big-1",
            groupId: "proj_test/group-a",
            value: bigValue,
          });

          await vi.waitFor(
            () => {
              expect(processed).toHaveBeenCalledTimes(1);
            },
            { timeout: 5000, interval: 50 },
          );

          expect(processed.mock.calls[0]![0].value).toBe(bigValue);
          expect(blobKeysDuringProcessing).toHaveLength(1);

          // ADR-046: completion reclaims nothing — the blob lives out its lease.
          const blobs = await redis.keys(`${queueName}:gq:blob:*`);
          expect(blobs).toHaveLength(1);
          expect(await redis.ttl(blobs[0]!)).toBeGreaterThan(0);
        });

        it("sets the lease TTL on the blob key at stage time", async () => {
          const queueName = `{test/gq/blob-${crypto.randomUUID().slice(0, 8)}}`;
          let release: () => void;
          const gate = new Promise<void>((resolve) => {
            release = resolve;
          });
          const processed = vi.fn(async (_payload: TestPayload) => {
            await gate;
          });

          const queue = createQueue(
            processed,
            { name: queueName },
            { objectStore: new InMemoryObjectStore() },
          );
          await queue.waitUntilReady();
          await queue.send({
            id: "big-2",
            groupId: "proj_test/group-a",
            value: "z".repeat(64 * 1024),
          });

          await vi.waitFor(
            async () => {
              expect(await redis.keys(`${queueName}:gq:blob:*`)).toHaveLength(
                1,
              );
            },
            { timeout: 5000, interval: 50 },
          );
          const [blobKey] = await redis.keys(`${queueName}:gq:blob:*`);
          expect(await redis.ttl(blobKey!)).toBeGreaterThan(0);
          release!();
        });
      });

      // ADR-046: a dedup squash's displaced blob is deliberately left to its
      // lease (the eager-reclaim refcount that once handled it was removed
      // after the 2026-07-09 phantom-hold leak). These tests pin the lease
      // behaviour: the surviving value resolves, nothing is deleted, and
      // every blob carries a finite TTL. The `delay` keeps both sends in
      // staging so the second squash-replaces the first in place.
      describe("when a dedup squash displaces a large payload", () => {
        const bigPayload = (filler: string): TestPayload => ({
          id: "dup",
          groupId: "proj_test/group-a",
          value: filler.repeat(64 * 1024),
        });

        it("leaves the displaced old blob to its lease and keeps the new value staged", async () => {
          const queueName = `{test/gq/blob-dedup-${crypto.randomUUID().slice(0, 8)}}`;
          const queue = createQueue(
            vi.fn().mockResolvedValue(undefined),
            {
              name: queueName,
              delay: 60_000,
              deduplication: { makeId: (p) => p.id, ttlMs: 120_000 },
            },
            { objectStore: new InMemoryObjectStore() },
          );
          await queue.waitUntilReady();

          await queue.send(bigPayload("a"));
          const [firstBlob] = await redis.keys(`${queueName}:gq:blob:*`);
          expect(firstBlob).toBeDefined();

          // Squash-replace: a fresh blob is staged; the displaced one is left
          // to its lease rather than reclaimed.
          await queue.send(bigPayload("b"));

          const blobs = await redis.keys(`${queueName}:gq:blob:*`);
          expect(blobs).toHaveLength(2);
          for (const key of blobs) {
            expect(await redis.ttl(key)).toBeGreaterThan(0);
          }
          // Staging holds exactly the one squashed job, referencing the new blob.
          expect(
            await redis.hlen(`${queueName}:gq:group:proj_test/group-a:data`),
          ).toBe(1);
        });

        it("keeps the existing payload's blob on replace:false and leaves the discarded one to its lease", async () => {
          const queueName = `{test/gq/blob-keep-${crypto.randomUUID().slice(0, 8)}}`;
          const queue = createQueue(
            vi.fn().mockResolvedValue(undefined),
            {
              name: queueName,
              delay: 60_000,
              deduplication: {
                makeId: (p) => p.id,
                ttlMs: 120_000,
                extend: false,
                replace: false,
              },
            },
            { objectStore: new InMemoryObjectStore() },
          );
          await queue.waitUntilReady();

          await queue.send(bigPayload("a"));
          const [keptBlob] = await redis.keys(`${queueName}:gq:blob:*`);
          expect(keptBlob).toBeDefined();

          // Dedup hit without replace: the new value never lands; its blob is
          // left to its lease and the original stays referenced.
          await queue.send(bigPayload("b"));

          const blobs = await redis.keys(`${queueName}:gq:blob:*`);
          expect(blobs).toContain(keptBlob);
          expect(
            await redis.hlen(`${queueName}:gq:group:proj_test/group-a:data`),
          ).toBe(1);
        });
      });
    });

    describe("per-group sequential processing", () => {
      describe("when multiple jobs share the same group key", () => {
        it("processes them one at a time, not in parallel", async () => {
          const concurrencyLog: { start: number; end: number }[] = [];
          let activeConcurrency = 0;
          let maxConcurrency = 0;

          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          processed.mockImplementation(async () => {
            activeConcurrency++;
            maxConcurrency = Math.max(maxConcurrency, activeConcurrency);
            const start = Date.now();
            await new Promise((resolve) => setTimeout(resolve, 100));
            const end = Date.now();
            concurrencyLog.push({ start, end });
            activeConcurrency--;
          });

          const queue = createQueue(processed, {
            options: { globalConcurrency: 5 },
          });
          await queue.waitUntilReady();

          // Send 3 jobs with the SAME group key
          for (let i = 0; i < 3; i++) {
            await queue.send({
              id: `seq-${i}`,
              groupId: "same-group",
              value: `job-${i}`,
            });
          }

          await vi.waitFor(
            () => {
              expect(processed).toHaveBeenCalledTimes(3);
            },
            { timeout: 30000, interval: 50 },
          );

          // Max concurrency within the same group must be 1
          expect(maxConcurrency).toBe(1);

          // Verify sequential: each job starts after the previous ends
          for (let i = 1; i < concurrencyLog.length; i++) {
            expect(concurrencyLog[i]!.start).toBeGreaterThanOrEqual(
              concurrencyLog[i - 1]!.end,
            );
          }
        });
      });
    });

    describe("deduplication with TOCTOU race", () => {
      describe("when dispatched job exists and new dedup job arrives", () => {
        it("processes both jobs (new job not silently dropped)", async () => {
          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          const processingStarted = new Promise<void>((resolve) => {
            let firstCall = true;
            processed.mockImplementation(async () => {
              if (firstCall) {
                firstCall = false;
                resolve();
                // Hold first job for 200ms to allow second send
                await new Promise((r) => setTimeout(r, 200));
              }
            });
          });

          const queue = createQueue(processed, {
            deduplication: {
              makeId: (p) => `${p.groupId}:${p.id}`,
              ttlMs: 10000,
            },
          });
          await queue.waitUntilReady();

          // Send payload A
          await queue.send({
            id: "race-job",
            groupId: "group-a",
            value: "first",
          });

          // Wait for A to start processing (dispatched)
          await processingStarted;

          // Send payload B with same dedupId while A is processing
          await queue.send({
            id: "race-job",
            groupId: "group-a",
            value: "second",
          });

          // Wait for both to complete. Generous ceiling: when the second
          // dedup job becomes due it produces no dispatcher signal, so its
          // dispatch waits for the next BRPOP timeout cycle (signalTimeoutSec,
          // 5s), and container clock skew widens that further on CI runners.
          // Same ceiling class as the squash test below.
          await vi.waitFor(
            () => {
              expect(processed).toHaveBeenCalledTimes(2);
            },
            { timeout: 30000, interval: 50 },
          );
        });
      });

      describe("when dedup squash happens before dispatch", () => {
        it("processes only once with squashed data", async () => {
          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          processed.mockResolvedValue(undefined);

          const queue = createQueue(processed, {
            delay: 200, // Long enough to squash before dispatch
            deduplication: {
              makeId: (p) => `${p.groupId}:${p.id}`,
              ttlMs: 10000,
            },
          });
          await queue.waitUntilReady();

          // Send A then B quickly (before dispatch happens)
          await queue.send({
            id: "squash-job",
            groupId: "group-a",
            value: "first",
          });
          await queue.send({
            id: "squash-job",
            groupId: "group-a",
            value: "second",
          });

          // Both stage signals fire before dispatchAfter (delay: 200), so the
          // dispatcher consumes and drains them while the job is not yet due.
          // Dispatch then rides the BRPOP idle-rescan net (signalTimeoutSec,
          // 5s), and on a loaded CI runner that net plus worker overhead can
          // exceed 10s of wall clock — same ceiling class as the TOCTOU
          // dispatch-gap flake. 30s gives the net 3x headroom.
          await vi.waitFor(
            () => {
              expect(processed).toHaveBeenCalledTimes(1);
            },
            { timeout: 30000, interval: 50 },
          );

          const receivedPayload = processed.mock.calls[0]![0];
          expect(receivedPayload.value).toBe("second");

          // Wait to confirm no second call
          await new Promise((r) => setTimeout(r, 500));
          expect(processed).toHaveBeenCalledTimes(1);
        });
      });
    });

    describe("cross-group parallel processing", () => {
      describe("when jobs have different group keys", () => {
        it("processes them concurrently", async () => {
          let peakConcurrency = 0;
          let activeConcurrency = 0;
          const processedGroups: string[] = [];

          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          processed.mockImplementation(async (payload) => {
            activeConcurrency++;
            peakConcurrency = Math.max(peakConcurrency, activeConcurrency);
            processedGroups.push(payload.groupId);
            await new Promise((resolve) => setTimeout(resolve, 200));
            activeConcurrency--;
          });

          const queue = createQueue(processed, {
            options: { globalConcurrency: 5 },
          });
          await queue.waitUntilReady();

          // Send 2 jobs with DIFFERENT group keys
          await queue.send({
            id: "par-1",
            groupId: "group-alpha",
            value: "alpha",
          });
          await queue.send({
            id: "par-2",
            groupId: "group-beta",
            value: "beta",
          });

          await vi.waitFor(
            () => {
              expect(processed).toHaveBeenCalledTimes(2);
            },
            { timeout: 30000, interval: 50 },
          );

          // Different groups should have been processed concurrently
          expect(peakConcurrency).toBe(2);
          expect(processedGroups).toContain("group-alpha");
          expect(processedGroups).toContain("group-beta");
        });
      });
    });

    describe("group coalescing", () => {
      describe("when a group is backed up", () => {
        /** @scenario 'A backed-up group is folded in a single batch call' */
        it("folds the queued events into a single processBatch call", async () => {
          const batches: TestPayload[][] = [];
          const singles: TestPayload[] = [];
          const queue = createQueue(
            async (p) => {
              singles.push(p);
            },
            {
              processBatch: async (ps) => {
                batches.push(ps as TestPayload[]);
              },
              coalesceMaxBatch: () => 50,
              score: (p) => Number(p.value) * 1000,
            },
          );
          await queue.waitUntilReady();

          const payloads = Array.from({ length: 10 }, (_, i) => ({
            id: `j${i}`,
            groupId: "group-a",
            value: String(i),
          }));
          await queue.sendBatch(payloads);

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
          // Every event processed exactly once across batches + singles.
          const allIds = [...batches.flat(), ...singles].map((p) => p.id);
          expect(new Set(allIds).size).toBe(10);
        });

        it("delivers a coalesced batch in ascending score order", async () => {
          let largest: TestPayload[] = [];
          const queue = createQueue(async () => {}, {
            processBatch: async (ps) => {
              if (ps.length > largest.length) largest = ps as TestPayload[];
            },
            coalesceMaxBatch: () => 50,
            score: (p) => Number(p.value) * 1000,
          });
          await queue.waitUntilReady();

          // Send shuffled; the queue must still fold them in score order.
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

        /** @scenario 'Coalescing respects the configured max batch size' */
        it("never exceeds coalesceMaxBatch per call", async () => {
          const batches: TestPayload[][] = [];
          const singles: TestPayload[] = [];
          const queue = createQueue(
            async (p) => {
              singles.push(p);
            },
            {
              processBatch: async (ps) => {
                batches.push(ps as TestPayload[]);
              },
              coalesceMaxBatch: () => 3,
              score: (p) => Number(p.value) * 1000,
            },
          );
          await queue.waitUntilReady();

          await queue.sendBatch(
            Array.from({ length: 9 }, (_, i) => ({ id: `j${i}`, groupId: "group-a", value: String(i) })),
          );

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
          const allIds = [...batches.flat(), ...singles].map((p) => p.id);
          expect(new Set(allIds).size).toBe(9);
        });
      });

      describe("when coalescing is disabled (maxBatch 1)", () => {
        /** @scenario 'Coalescing is a no-op when disabled' */
        it("processes each event individually and never calls processBatch", async () => {
          const batches: TestPayload[][] = [];
          const singles: TestPayload[] = [];
          const queue = createQueue(
            async (p) => {
              singles.push(p);
            },
            {
              processBatch: async (ps) => {
                batches.push(ps as TestPayload[]);
              },
              coalesceMaxBatch: () => 1,
              score: (p) => Number(p.value) * 1000,
            },
          );
          await queue.waitUntilReady();

          await queue.sendBatch(
            Array.from({ length: 5 }, (_, i) => ({ id: `j${i}`, groupId: "group-a", value: String(i) })),
          );

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
        /** @scenario 'A failed coalesced batch re-stages its drained siblings' */
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
                for (const p of ps) succeeded.push(p as TestPayload);
              },
              coalesceMaxBatch: () => 50,
              score: (p) => Number(p.value) * 1000,
            },
          );
          await queue.waitUntilReady();

          await queue.sendBatch(
            Array.from({ length: 4 }, (_, i) => ({ id: `j${i}`, groupId: "group-a", value: String(i) })),
          );

          // Despite the first batch throwing, every event is eventually
          // processed — the drained siblings were re-staged, not lost.
          // The retry re-stages with a future score and no signal, so the
          // dispatcher only picks it up on its BRPOP fallback poll
          // (signalTimeoutSec = 5s, plus the active-key backoff TTL). The
          // window must absorb several poll cycles on a CPU-starved CI runner.
          await vi.waitFor(
            () => {
              expect(new Set(succeeded.map((p) => p.id)).size).toBe(4);
            },
            { timeout: 45000, interval: 100 },
          );
        });
      });
    });
  },
);
