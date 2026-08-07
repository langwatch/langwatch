import type { Redis } from "ioredis";
import { register } from "prom-client";
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
import {
  getTestRedisConnection,
  startTestContainers,
  stopTestContainers,
} from "../../../__tests__/integration/testContainers";
import { ConfigurationError } from "../../../services/errorHandling";
import type {
  EventSourcedQueueDefinition,
  JobDelivery,
} from "../../queue.types";
import { GroupQueueProcessor } from "../groupQueue";
import { DEFAULT_BISECTION_SPLITS_PER_DISPATCH } from "../scripts";

async function foreignSiblingsRestagedCount(
  queueName: string,
): Promise<number> {
  const metric = await register
    .getSingleMetric("gq_foreign_siblings_restaged_total")
    ?.get();
  return (
    metric?.values.find((v) => v.labels.queue_name === queueName)?.value ?? 0
  );
}

async function readyScoreImplausibleCount(queueName: string): Promise<number> {
  const metric = await register
    .getSingleMetric("gq_ready_score_implausible_total")
    ?.get();
  return (
    metric?.values.find((v) => v.labels.queue_name === queueName)?.value ?? 0
  );
}

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

/**
 * Ready scores are validated against the staging clock now (`resolveReadyScore`),
 * so a bare ordinal like `value * 1000` is rejected as "not a timestamp" and
 * replaced with the staging time - which would silently turn every ordering
 * assertion below into an assertion about arrival order. Anchor the ordinal to a
 * real, recent timestamp instead: same relative order, and it exercises the
 * shape a production score function actually returns.
 */
const SCORE_BASE_MS = Date.now() - 60 * 60 * 1000;
const orderedScore = (n: number): number => SCORE_BASE_MS + n * 1000;

function createQueueDefinition(
  overrides: Partial<EventSourcedQueueDefinition<TestPayload>> & {
    process: (payload: TestPayload) => Promise<void>;
  },
): EventSourcedQueueDefinition<TestPayload> {
  return {
    name: `{test/gqmain/${crypto.randomUUID().slice(0, 8)}}`,
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
      await Promise.all(queues.map((q) => q.close().catch(() => {})));
      // Scoped to this suite's own namespace, never flushdb(). flushdb empties
      // the whole logical database, so it does not just reset this suite — it
      // deletes whatever another suite has in flight in the same database.
      // The failure then lands over there, in a file that never called it.
      const keys = await redis.keys("{test/gqmain/*");
      if (keys.length > 0) await redis.del(...keys);
    });

    afterAll(async () => {
      await stopTestContainers();
    });

    function createQueue(
      processFn: (payload: TestPayload) => Promise<void>,
      overrides?: Partial<EventSourcedQueueDefinition<TestPayload>>,
    ): GroupQueueProcessor<TestPayload> {
      const queue = new GroupQueueProcessor<TestPayload>(
        createQueueDefinition({ process: processFn, ...overrides }),
        redis,
      );
      queues.push(queue);
      return queue;
    }

    describe("send()", () => {
      describe("when jobs are staged faster than they are processed", () => {
        /** @scenario "Staging a job records its group as holding pending work" */
        it("records the group in the pending index", async () => {
          // The ops reconcile counts jobs by asking this index which groups to
          // look at, and it is written by the staging script itself. Held here
          // by a processor that never finishes the first job, so the siblings
          // stay staged for the assertion.
          let releaseFirst: (() => void) | undefined;
          const firstJobHeld = new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
          const queueName = `{test/gqmain/${crypto.randomUUID().slice(0, 8)}}`;
          const queue = createQueue(
            async () => {
              await firstJobHeld;
            },
            { name: queueName },
          );
          await queue.waitUntilReady();

          for (const id of ["p1", "p2", "p3"]) {
            await queue.send({ id, groupId: "pending-group", value: id });
          }

          try {
            await vi.waitFor(
              async () => {
                expect(
                  await redis.sismember(
                    `${queueName}:gq:pending-groups`,
                    "pending-group",
                  ),
                ).toBe(1);
              },
              { timeout: 5000, interval: 50 },
            );
          } finally {
            // Unblock the processor even when the assertion fails, so teardown
            // closes a queue that is idle rather than waiting out its shutdown
            // timeout and charging the delay to whichever test runs next.
            releaseFirst?.();
          }
        });
      });

      describe("when a producer's score function returns a value that is not a timestamp", () => {
        /**
         * The end-to-end version of the 2026-07-31 / 2026-08-03 defect, and the
         * one assertion the unit tests cannot make: that what is WRITTEN to
         * Redis is the resolved score, and that the resolved score takes its
         * place in the real dispatch order.
         *
         * A test that recomputes the expected score in the test body would keep
         * passing if `send` stopped calling the guard altogether. This one reads
         * the staged score back out of the group's own jobs zset.
         */
        /** @scenario "a job staged with an unusable score dispatches behind one that occurred earlier" */
        it("stages it at the current time and dispatches it behind a genuinely older job", async () => {
          const processedOrder: string[] = [];
          let releaseBlocker: (() => void) | undefined;
          const blockerHeld = new Promise<void>((resolve) => {
            releaseBlocker = resolve;
          });

          const queueName = `{test/gqmain/${crypto.randomUUID().slice(0, 8)}}`;
          const scores: Record<string, number> = {
            blocker: SCORE_BASE_MS,
            older: Date.now() - 60_000,
            broken: 0,
          };
          const queue = createQueue(
            async (p) => {
              if (p.id === "blocker") await blockerHeld;
              processedOrder.push(p.id);
            },
            { name: queueName, score: (p) => scores[p.id] ?? 0 },
          );
          await queue.waitUntilReady();

          // The blocker is staged first and carries the lowest score, so it
          // leads the group and holds it while the two jobs behind it stay
          // staged long enough to read their scores back out of Redis.
          await queue.send({ id: "blocker", groupId: "g", value: "b" });

          const stagedAtLeast = Date.now();
          await queue.send({ id: "broken", groupId: "g", value: "x" });
          await queue.send({ id: "older", groupId: "g", value: "y" });

          try {
            const jobsKey = `${queueName}:gq:group:g:jobs`;
            await vi.waitFor(
              async () => {
                expect(await redis.zcard(jobsKey)).toBeGreaterThanOrEqual(2);
              },
              { timeout: 5000, interval: 50 },
            );

            // The broken score reached Redis as a real timestamp, not as 0.
            const staged = await redis.zrange(jobsKey, 0, -1, "WITHSCORES");
            const brokenScore = Number(
              staged[staged.findIndex((m) => m.includes("broken")) + 1],
            );
            expect(brokenScore).toBeGreaterThanOrEqual(stagedAtLeast);
            expect(brokenScore).toBeLessThanOrEqual(Date.now() + 1000);
          } finally {
            releaseBlocker?.();
          }

          await vi.waitFor(
            () => {
              expect(processedOrder).toHaveLength(3);
            },
            { timeout: 30000, interval: 50 },
          );

          // Rescored to now, so it sorts BEHIND the job that really did occur a
          // minute ago. Staged at 0 it would have led the group for ever.
          expect(processedOrder).toEqual(["blocker", "older", "broken"]);

          // Exactly one: the counter reports PRODUCERS, so only the supplied
          // score the queue refused registers. The two accepted scores do not,
          // and neither would a re-stage - see `restageScore`.
          expect(await readyScoreImplausibleCount(queueName)).toBe(1);
        });
      });

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
        it("never drops the later payload when two sends share a dedup key", async () => {
          const processed = vi.fn<(payload: TestPayload) => Promise<void>>();
          processed.mockResolvedValue(undefined);

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

          // Nothing orders the second send against the dispatcher, so either
          // call count is correct. While the first job is still staged, the
          // second send squashes it in place and only "second" is processed.
          // Once the first job has been dispatched, the dedup key is stale, so
          // it is cleaned up and the second send stages a fresh job, giving
          // "first" then "second". Either way the later payload must arrive.
          // Generous ceiling: a job that becomes due with no dispatcher signal
          // left waits for the next BRPOP timeout cycle (signalTimeoutSec, 5s).
          await vi.waitFor(
            () => {
              const calls = processed.mock.calls;
              expect(calls.length).toBeGreaterThan(0);
              expect(calls[calls.length - 1]![0].value).toBe("second");
            },
            { timeout: 30000, interval: 50 },
          );

          expect(processed.mock.calls.length).toBeLessThanOrEqual(2);
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
      describe("when a payload exceeds the blob offload threshold", () => {
        it("stores the body under a blob key, delivers it intact, and deletes the blob on completion", async () => {
          vi.stubEnv("GROUP_QUEUE_ENVELOPE_WRITES_ENABLED", "true");
          try {
            const queueName = `{test/gqmain/blob-${crypto.randomUUID().slice(0, 8)}}`;
            const blobKeysDuringProcessing: string[] = [];
            const processed = vi.fn(async (_payload: TestPayload) => {
              blobKeysDuringProcessing.push(
                ...(await redis.keys(`${queueName}:gq:blob:*`)),
              );
            });

            const queue = createQueue(processed, { name: queueName });
            await queue.waitUntilReady();

            const bigValue = "z".repeat(64 * 1024);
            await queue.send({
              id: "big-1",
              groupId: "group-a",
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

            await vi.waitFor(
              async () => {
                expect(await redis.keys(`${queueName}:gq:blob:*`)).toHaveLength(
                  0,
                );
              },
              { timeout: 5000, interval: 50 },
            );
          } finally {
            vi.unstubAllEnvs();
          }
        });

        it("sets a TTL safety net on the blob key", async () => {
          vi.stubEnv("GROUP_QUEUE_ENVELOPE_WRITES_ENABLED", "true");
          try {
            const queueName = `{test/gqmain/blob-${crypto.randomUUID().slice(0, 8)}}`;
            let release: () => void;
            const gate = new Promise<void>((resolve) => {
              release = resolve;
            });
            const processed = vi.fn(async (_payload: TestPayload) => {
              await gate;
            });

            const queue = createQueue(processed, { name: queueName });
            await queue.waitUntilReady();
            await queue.send({
              id: "big-2",
              groupId: "group-a",
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
          } finally {
            vi.unstubAllEnvs();
          }
        });
      });

      // Regression for the 2026-06-11 Redis capacity incident: a dedup squash
      // displaced a blob-backed payload but nothing reclaimed the displaced
      // blob, so ~280K orphans (~7.4 GB) accumulated until their 7-day TTL. The
      // `delay` keeps both sends in staging so the second squash-replaces the
      // first in place (the production path: a reactor re-folding a turn).
      describe("when a dedup squash displaces a large payload", () => {
        const bigPayload = (filler: string): TestPayload => ({
          id: "dup",
          groupId: "group-a",
          value: filler.repeat(64 * 1024),
        });

        it("reclaims the displaced old blob on replace so it cannot leak", async () => {
          vi.stubEnv("GROUP_QUEUE_ENVELOPE_WRITES_ENABLED", "true");
          try {
            const queueName = `{test/gqmain/blob-dedup-${crypto.randomUUID().slice(0, 8)}}`;
            const queue = createQueue(vi.fn().mockResolvedValue(undefined), {
              name: queueName,
              delay: 60_000,
              deduplication: { makeId: (p) => p.id, ttlMs: 120_000 },
            });
            await queue.waitUntilReady();

            await queue.send(bigPayload("a"));
            const [firstBlob] = await redis.keys(`${queueName}:gq:blob:*`);
            expect(firstBlob).toBeDefined();

            // Squash-replace: a fresh blob is staged and the first is displaced.
            await queue.send(bigPayload("b"));

            // The displaced blob is reclaimed fire-and-forget; only the new
            // one survives.
            await vi.waitFor(
              async () => {
                const blobs = await redis.keys(`${queueName}:gq:blob:*`);
                expect(blobs).toHaveLength(1);
                expect(blobs).not.toContain(firstBlob);
              },
              { timeout: 5000, interval: 50 },
            );
            // Staging holds exactly the one squashed job, referencing the new blob.
            expect(await redis.hlen(`${queueName}:gq:group:group-a:data`)).toBe(
              1,
            );
          } finally {
            vi.unstubAllEnvs();
          }
        });

        it("reclaims the discarded new blob when the existing payload is kept (replace:false)", async () => {
          vi.stubEnv("GROUP_QUEUE_ENVELOPE_WRITES_ENABLED", "true");
          try {
            const queueName = `{test/gqmain/blob-keep-${crypto.randomUUID().slice(0, 8)}}`;
            const queue = createQueue(vi.fn().mockResolvedValue(undefined), {
              name: queueName,
              delay: 60_000,
              deduplication: {
                makeId: (p) => p.id,
                ttlMs: 120_000,
                extend: false,
                replace: false,
              },
            });
            await queue.waitUntilReady();

            await queue.send(bigPayload("a"));
            const [keptBlob] = await redis.keys(`${queueName}:gq:blob:*`);
            expect(keptBlob).toBeDefined();

            // Dedup hit without replace: the new value never lands, its blob is
            // discarded and reclaimed fire-and-forget; the original blob stays.
            await queue.send(bigPayload("b"));

            await vi.waitFor(
              async () => {
                expect(await redis.keys(`${queueName}:gq:blob:*`)).toEqual([
                  keptBlob,
                ]);
              },
              { timeout: 5000, interval: 50 },
            );
            expect(await redis.hlen(`${queueName}:gq:group:group-a:data`)).toBe(
              1,
            );
          } finally {
            vi.unstubAllEnvs();
          }
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
              score: (p) => orderedScore(Number(p.value)),
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
              const total =
                batches.reduce((n, b) => n + b.length, 0) + singles.length;
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
            score: (p) => orderedScore(Number(p.value)),
          });
          await queue.waitUntilReady();

          // Send shuffled; the queue must still fold them in score order.
          await queue.sendBatch(
            [4, 2, 0, 3, 1].map((n) => ({
              id: `j${n}`,
              groupId: "group-a",
              value: String(n),
            })),
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
              score: (p) => orderedScore(Number(p.value)),
            },
          );
          await queue.waitUntilReady();

          await queue.sendBatch(
            Array.from({ length: 9 }, (_, i) => ({
              id: `j${i}`,
              groupId: "group-a",
              value: String(i),
            })),
          );

          await vi.waitFor(
            () => {
              const total =
                batches.reduce((n, b) => n + b.length, 0) + singles.length;
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

      describe("when one payload in a coalesced batch is unprocessable", () => {
        /** @scenario 'Payloads ahead of an unprocessable one still commit' */
        it("commits every payload ahead of it and narrows the failure to it alone", async () => {
          // Payloads AFTER the offender deliberately do not commit here: the
          // fold derives fields from arrival order, so applying j6 while j5 is
          // unresolved would leave a silent gap. Bisection's job is to stop
          // losing the payloads BEFORE the offender and to name it — not to
          // step over it. Letting later work past requires deciding what to do
          // about that gap, which is the side-lining decision (#6482).
          const POISON = "j5";
          const attempted: TestPayload[][] = [];
          // An ARRAY, not a set: a set cannot tell "committed once" from
          // "committed twice", and the second is the thing worth watching when
          // a dispatch applies part of a batch before failing.
          const committed: string[] = [];

          const queue = createQueue(
            async (p) => {
              // Only reached when the queue dispatches a job with no siblings
              // to coalesce. A split that narrows to one payload still goes
              // through processBatch with a one-element batch, never here.
              if (p.id === POISON) throw new Error("unprocessable payload");
              committed.push(p.id);
            },
            {
              processBatch: async (ps) => {
                const batch = ps as TestPayload[];
                attempted.push(batch);
                // Fails for any batch containing the poison payload — including
                // the batch of exactly one, which is what makes it attributable.
                if (batch.some((p) => p.id === POISON)) {
                  throw new Error("unprocessable payload");
                }
                for (const p of batch) committed.push(p.id);
              },
              coalesceMaxBatch: () => 50,
              score: (p) => Number(p.value) * 1000,
            },
          );
          await queue.waitUntilReady();

          // Future-dated so all eight are staged before any is due — staging
          // races the dispatcher, and a partial root softens the exact descent
          // this test asserts.
          const dueAt = Date.now() + 2500;
          await queue.sendBatch(
            Array.from({ length: 8 }, (_, i) => ({
              id: `j${i}`,
              groupId: "group-a",
              value: String((dueAt + i) / 1000),
            })),
          );

          const HEALTHY_PREFIX = ["j0", "j1", "j2", "j3", "j4"] as const;

          // j0..j4 commit despite sharing a batch with the offender. Without
          // bisection the whole batch fails together and NONE of them apply —
          // that is the regression this pins.
          await vi.waitFor(
            () => {
              expect([...new Set(committed)].sort()).toEqual(HEALTHY_PREFIX);
            },
            { timeout: 30000, interval: 50 },
          );
          expect(committed).not.toContain(POISON);

          // No payload is applied more often than its peers. The prefix always
          // commits as a unit, so equal counts hold however many times the
          // group is redelivered — while a payload applied one extra time (the
          // failure a set-based assertion cannot see) breaks equality.
          //
          // Scope note: this pins that BISECTION does not re-run a payload it
          // already committed within a dispatch. Redelivery across dispatches
          // is at-least-once by design and is made safe by the fold store's
          // applied-event-id set, which has its own suite
          // (projections/foldCache/__tests__/foldRedeliveryIdempotency) — this
          // handler is a mock with no such guard, so asserting it here would
          // test the mock rather than the queue.
          const counts = HEALTHY_PREFIX.map(
            (id) => committed.filter((c) => c === id).length,
          );
          expect(new Set(counts).size).toBe(1);

          // The split actually narrowed to the offender rather than retrying
          // the batch whole: some attempt isolated it on its own.
          const isolated = attempted.filter(
            (b) => b.length === 1 && b[0]?.id === POISON,
          );
          expect(isolated.length).toBeGreaterThanOrEqual(1);
        });

        /** @scenario 'Each half of a split stays in arrival order' */
        it("keeps each half in arrival order while splitting", async () => {
          const POISON = "j6";
          const attempted: TestPayload[][] = [];

          const queue = createQueue(
            async (p) => {
              if (p.id === POISON) throw new Error("unprocessable payload");
            },
            {
              processBatch: async (ps) => {
                const batch = ps as TestPayload[];
                attempted.push(batch);
                if (batch.some((p) => p.id === POISON)) {
                  throw new Error("unprocessable payload");
                }
              },
              coalesceMaxBatch: () => 50,
              score: (p) => Number(p.value) * 1000,
            },
          );
          await queue.waitUntilReady();

          // Future-dated so all eight are staged before any is due — staging
          // races the dispatcher, and a partial root softens the exact descent
          // this test asserts.
          const dueAt = Date.now() + 2500;
          await queue.sendBatch(
            Array.from({ length: 8 }, (_, i) => ({
              id: `j${i}`,
              groupId: "group-a",
              value: String((dueAt + i) / 1000),
            })),
          );

          await vi.waitFor(
            () => {
              expect(
                attempted.some((b) => b.length === 1 && b[0]?.id === POISON),
              ).toBe(true);
            },
            { timeout: 30000, interval: 50 },
          );

          // The ordering invariant: a fold derives fields from arrival order, so
          // every sub-batch a split produces must still be ascending and
          // contiguous — never a reshuffle or an interleave.
          for (const batch of attempted) {
            // Contiguity in the ORIGINAL arrival sequence: ids are j0..j7, so
            // a sub-batch must be a run of consecutive indices — a reshuffle
            // or an interleave breaks either the ordering or the step.
            const indices = batch.map((p) => Number(p.id.slice(1)));
            expect(indices).toEqual([...indices].sort((a, b) => a - b));
            for (let i = 1; i < indices.length; i++) {
              expect(indices[i]! - indices[i - 1]!).toBe(1);
            }
          }
        });
      });

      describe("when payloads arrive out of order and the batch is bisected", () => {
        /** @scenario "A split descent emits in the queue's order" */
        it("still processes every payload in the queue's order, across sub-batches", async () => {
          // The contiguity check above proves each sub-batch is internally
          // ordered. It cannot see the order the sub-batches RUN in — a
          // descent that took the right half first would satisfy it while
          // folding later events before earlier ones. This pins the global
          // sequence, which is the property a fold actually depends on.
          //
          // Every payload shares one score so they all become due together and
          // coalesce into a single root; `sendBatch` then breaks the tie by
          // position (`dispatchAfterMs = score + delay + index`), so the
          // queue's arrival order IS the send order. Sending id-shuffled makes
          // the two differ, so a bisector keyed on the id rather than on the
          // queue's sequence would be caught.
          const MAX_WORKABLE = 2;
          const processedInOrder: number[] = [];
          const attemptedSizes: number[] = [];

          const queue = createQueue(
            async (p) => {
              processedInOrder.push(Number(p.id.slice(1)));
            },
            {
              processBatch: async (ps) => {
                attemptedSizes.push(ps.length);
                if (ps.length > MAX_WORKABLE) {
                  throw new Error("batch exceeded the downstream budget");
                }
                for (const p of ps as TestPayload[]) {
                  processedInOrder.push(Number(p.id.slice(1)));
                }
              },
              coalesceMaxBatch: () => 50,
              score: (p) => Number(p.value),
            },
          );
          await queue.waitUntilReady();

          const dueAt = Date.now() + 2500;
          const sendOrder = [5, 2, 7, 0, 4, 1, 6, 3];
          await queue.sendBatch(
            sendOrder.map((i) => ({
              id: `j${i}`,
              groupId: "group-a",
              value: String(dueAt),
            })),
          );

          // At-LEAST-8, not exactly 8: an over-delivery would never satisfy an
          // exact-length wait, so the bug would surface as an opaque 30s
          // timeout instead of the array diff below.
          await vi.waitFor(
            () => {
              expect(processedInOrder.length).toBeGreaterThanOrEqual(8);
            },
            { timeout: 30000, interval: 50 },
          );

          // Guard against the test going vacuous: it only says anything about
          // bisection if a batch too large to process was actually split.
          expect(Math.max(...attemptedSizes)).toBeGreaterThan(MAX_WORKABLE);

          // Globally in the queue's order: every payload folded after the one
          // the queue sequenced before it, however the descent carved the batch.
          expect(processedInOrder).toEqual(sendOrder);
        });
      });

      describe("when a coalesced batch fails only because it is too large", () => {
        /** @scenario 'A batch too large for the handler converges by halving' */
        it("halves it until it fits and commits every payload once", async () => {
          const MAX_WORKABLE = 2;
          const seen: string[] = [];

          const sizes: number[] = [];
          let inFlight = 0;
          let maxConcurrent = 0;

          const queue = createQueue(
            async (p) => {
              seen.push(p.id);
            },
            {
              processBatch: async (ps) => {
                const batch = ps as TestPayload[];
                sizes.push(batch.length);
                inFlight += 1;
                maxConcurrent = Math.max(maxConcurrent, inFlight);
                // Yield so a concurrent sibling call would overlap here and be
                // caught by maxConcurrent, rather than being hidden by a
                // handler that never awaits.
                await new Promise((resolve) => setTimeout(resolve, 5));
                inFlight -= 1;
                // Models a size-driven downstream limit (a query that exceeds
                // its memory budget): nothing is wrong with any individual
                // payload, the batch is simply too big for one pass.
                if (batch.length > MAX_WORKABLE) {
                  throw new Error("batch exceeded the downstream budget");
                }
                for (const p of batch) seen.push(p.id);
              },
              coalesceMaxBatch: () => 50,
              score: (p) => Number(p.value) * 1000,
            },
          );
          await queue.waitUntilReady();

          // Future-dated so all eight are staged before any is due — staging
          // races the dispatcher, and a partial root softens the exact descent
          // this test asserts.
          const dueAt = Date.now() + 2500;
          await queue.sendBatch(
            Array.from({ length: 8 }, (_, i) => ({
              id: `j${i}`,
              groupId: "group-a",
              value: String((dueAt + i) / 1000),
            })),
          );

          await vi.waitFor(
            () => {
              expect(new Set(seen).size).toBe(8);
            },
            { timeout: 30000, interval: 50 },
          );

          // Converged by construction rather than by a retry happening to
          // re-assemble a smaller batch — and without re-applying a payload
          // that already succeeded inside this dispatch.
          expect(seen.length).toBe(8);

          // The exact descent, which a "sizes are non-increasing" assertion
          // would not pin: 8 fails, its left half 4 fails, that half's two 2s
          // succeed, then the right 4 fails and its two 2s succeed. Any
          // concurrency between halves, or a fallback to one-at-a-time instead
          // of halving, produces a different sequence.
          expect(sizes).toEqual([8, 4, 2, 2, 4, 2, 2]);

          // Sequential, not merely ordered: no batch ever started while
          // another was still running.
          expect(maxConcurrent).toBe(1);
        });
      });

      describe("when a coalesced batch fails non-retryably", () => {
        /** @scenario 'A non-retryable failure is never split' */
        it("fails fast without splitting", async () => {
          const attempts: number[] = [];

          const queue = createQueue(async () => {}, {
            processBatch: async (ps) => {
              attempts.push(ps.length);
              // CRITICAL category — `isRetryableJobError` is false for this, so
              // the batch must not be split: it would fail identically at every
              // size, and bisecting only multiplies work before the same
              // verdict.
              throw new ConfigurationError("test-handler", "not retryable");
            },
            coalesceMaxBatch: () => 50,
            score: (p) => Number(p.value) * 1000,
          });
          await queue.waitUntilReady();

          // Future-dated so all eight are staged before any is due — staging
          // races the dispatcher, and a partial root softens the exact descent
          // this test asserts.
          const dueAt = Date.now() + 2500;
          await queue.sendBatch(
            Array.from({ length: 8 }, (_, i) => ({
              id: `j${i}`,
              groupId: "group-a",
              value: String((dueAt + i) / 1000),
            })),
          );

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
        /** @scenario 'Setting the split budget to zero disables bisection' */
        it("never splits, restoring the pre-bisection behaviour", async () => {
          // The kill switch: an operator can disable bisection through the
          // environment rather than waiting on a deploy.
          vi.stubEnv("LANGWATCH_GQ_BISECTION_SPLIT_BUDGET", "0");
          const sizes: number[] = [];
          const queue = createQueue(async () => {}, {
            processBatch: async (ps) => {
              sizes.push(ps.length);
              throw new Error("retryable");
            },
            coalesceMaxBatch: () => 8,
          });
          await queue.waitUntilReady();

          const entries = Array.from({ length: 4 }, (_, i) => ({
            payload: { id: `j${i}`, groupId: "group-a", value: String(i) },
            stagedJobId: `job-${i}`,
          }));

          await expect(
            (
              queue as unknown as {
                processBatchBisecting: (args: {
                  entries: typeof entries;
                  attempt: number;
                  routingLabels: Record<string, string>;
                  span: never;
                }) => Promise<void>;
              }
            ).processBatchBisecting({
              entries,
              attempt: 1,
              routingLabels: {
                queue_name: "q",
                pipeline_name: "p",
                job_type: "t",
                job_name: "n",
              },
              span: { addEvent: () => {}, setAttribute: () => {} } as never,
            }),
          ).rejects.toThrow("retryable");

          // One call, the whole batch, no descent.
          expect(sizes).toEqual([4]);
          vi.unstubAllEnvs();
        });
      });

      describe("when the root of a bisected batch commits and then fails", () => {
        // Driven through the bisector directly: this is about which delivery
        // flags the descent emits, and staged dispatch adds timing noise that
        // has nothing to do with the contract.
        /** @scenario 'Sub-batches after the first commit are marked as continuations' */
        it("marks the sub-batches as continuations so their commits extend rather than replace", async () => {
          const deliveries: (JobDelivery | undefined)[] = [];
          let rootFailed = false;

          const queue = createQueue(async () => {}, {
            processBatch: async (ps, delivery) => {
              deliveries.push(delivery);
              // The post-store window: the handler COMMITS and only then
              // throws (a reactor failing after the fold stored). The commit
              // is the part that matters — a later sub-batch that replaces
              // the applied set erases what this call recorded.
              if (!rootFailed && ps.length > 1) {
                rootFailed = true;
                throw new Error("reactor failed after the fold was stored");
              }
            },
            coalesceMaxBatch: () => 8,
          });
          await queue.waitUntilReady();

          const entries = Array.from({ length: 4 }, (_, i) => ({
            payload: { id: `j${i}`, groupId: "group-a", value: String(i) },
            stagedJobId: `job-${i}`,
          }));

          await (
            queue as unknown as {
              processBatchBisecting: (args: {
                entries: typeof entries;
                attempt: number;
                routingLabels: Record<string, string>;
                span: never;
              }) => Promise<void>;
            }
          ).processBatchBisecting({
            entries,
            attempt: 1,
            routingLabels: {
              queue_name: "q",
              pipeline_name: "p",
              job_type: "t",
              job_name: "n",
            },
            span: { addEvent: () => {}, setAttribute: () => {} } as never,
          });

          // The root is a fresh delivery; every call the split produces after
          // it must be a continuation, because the root already wrote.
          expect(deliveries[0]?.isContinuation).toBeUndefined();
          expect(deliveries.length).toBeGreaterThan(1);
          expect(
            deliveries.slice(1).every((d) => d?.isContinuation === true),
          ).toBe(true);
        });
      });

      describe("when a batch degrades toward singletons", () => {
        // Driven through the bisector directly rather than via staged dispatch:
        // how large a root the drain assembles varies with staging timing, and
        // this contract — bounded work per locked attempt — must hold for any
        // shape, so the test pins it on the worst one deterministically.
        /** @scenario 'Splitting is bounded within one locked attempt' */
        it("stops splitting at the budget and rethrows to the retry path", async () => {
          const sizes: number[] = [];
          const queue = createQueue(async () => {}, {
            processBatch: async (ps) => {
              sizes.push(ps.length);
              // Only singletons fit: without a budget this walks the entire
              // tree — 127 calls for 64 payloads — inside one locked attempt.
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
          const span = {
            addEvent: () => {},
            setAttribute: () => {},
          } as never;

          await expect(
            (
              queue as unknown as {
                processBatchBisecting: (args: {
                  entries: typeof entries;
                  attempt: number;
                  routingLabels: Record<string, string>;
                  span: never;
                }) => Promise<void>;
              }
            ).processBatchBisecting({
              entries,
              attempt: 1,
              routingLabels: {
                queue_name: "q",
                pipeline_name: "p",
                job_type: "t",
                job_name: "n",
              },
              span,
            }),
          ).rejects.toThrow("only singletons fit");

          // Splits are the calls that failed with more than one payload; the
          // budget caps them at DEFAULT_BISECTION_SPLITS_PER_DISPATCH. Total calls
          // stay far below the 127-call full walk that completing without a
          // budget would require — and the throw above is the yield itself:
          // the dispatch fails to the normal restage/backoff machinery instead
          // of finishing the walk under the group lock.
          const splits = sizes.filter((n) => n > 1).length;
          expect(splits).toBeLessThanOrEqual(
            DEFAULT_BISECTION_SPLITS_PER_DISPATCH + 1,
          );
          expect(sizes.length).toBeLessThan(80);
          expect(sizes.length).toBeGreaterThan(5);
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
              score: (p) => orderedScore(Number(p.value)),
            },
          );
          await queue.waitUntilReady();

          await queue.sendBatch(
            Array.from({ length: 5 }, (_, i) => ({
              id: `j${i}`,
              groupId: "group-a",
              value: String(i),
            })),
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
              score: (p) => orderedScore(Number(p.value)),
            },
          );
          await queue.waitUntilReady();

          await queue.sendBatch(
            Array.from({ length: 4 }, (_, i) => ({
              id: `j${i}`,
              groupId: "group-a",
              value: String(i),
            })),
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

      // ADR-066 pillar 2: the drain is bounded by bytes as well as count. These
      // exercise the byte budget end-to-end through the GroupQueueProcessor. Byte
      // math is asserted at the Lua level in scripts.integration.test.ts; here we
      // only need the observable: a burst that the count bound alone would fold
      // whole is split by the byte bound, and nothing is lost.
      describe("when a byte budget bounds the batch", () => {
        /** @scenario 'a batch is bounded by size as well as count' */
        it("splits a burst at the byte budget and loses nothing", async () => {
          const batches: TestPayload[][] = [];
          const singles: TestPayload[] = [];
          const bulk = "x".repeat(500);
          const queue = createQueue(
            async (p) => {
              singles.push(p);
            },
            {
              processBatch: async (ps) => {
                batches.push(ps as TestPayload[]);
              },
              coalesceMaxBatch: () => 50,
              coalesceMaxBytes: () => 1500,
              score: (p) => orderedScore(Number((p.id as string).slice(1))),
            },
          );
          await queue.waitUntilReady();

          await queue.sendBatch(
            Array.from({ length: 6 }, (_, i) => ({
              id: `j${i}`,
              groupId: "group-a",
              value: bulk,
            })),
          );

          await vi.waitFor(
            () => {
              const total =
                batches.reduce((n, b) => n + b.length, 0) + singles.length;
              expect(total).toBe(6);
            },
            { timeout: 30000, interval: 50 },
          );

          // The byte bound bit: the whole burst never collapsed into one batch,
          // even though the count bound alone (50) would have folded all six.
          const maxBatch =
            batches.length > 0 ? Math.max(...batches.map((b) => b.length)) : 0;
          expect(maxBatch).toBeLessThan(6);
          // ...but a coalesced batch DID form — without this floor the assertion
          // above passes vacuously when nothing coalesces (maxBatch 0), leaving
          // the byte-split path untested. A batch of ≥2 proves siblings folded
          // up to the byte budget rather than each dispatching alone.
          expect(maxBatch).toBeGreaterThanOrEqual(2);
          // Every event processed exactly once — the remainder became later batches.
          const allIds = [...batches.flat(), ...singles].map((p) => p.id);
          expect(new Set(allIds).size).toBe(6);
        });

        /** @scenario 'a single oversized item is appended on its own' */
        it("processes an oversized job on its own, coalescing nothing", async () => {
          const batches: TestPayload[][] = [];
          const singles: TestPayload[] = [];
          const bulk = "x".repeat(500);
          const queue = createQueue(
            async (p) => {
              singles.push(p);
            },
            {
              processBatch: async (ps) => {
                batches.push(ps as TestPayload[]);
              },
              coalesceMaxBatch: () => 50,
              // Smaller than any single job's stored size, so every dispatch's
              // own initialBytes already exceeds the budget.
              coalesceMaxBytes: () => 50,
              score: (p) => orderedScore(Number((p.id as string).slice(1))),
            },
          );
          await queue.waitUntilReady();

          await queue.sendBatch(
            Array.from({ length: 4 }, (_, i) => ({
              id: `j${i}`,
              groupId: "group-a",
              value: bulk,
            })),
          );

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

      // ADR-066 pillar 2: serialized commands share a group across command types,
      // so a drained sibling can belong to a DIFFERENT __jobName. A coalesced
      // batch must never mix job names; foreign siblings are restaged, not folded.
      describe("when a group mixes __jobName (serialized commands)", () => {
        /** @scenario 'coalescing preserves every item' */
        it("never mixes __jobName within a batch and restages foreign siblings", async () => {
          const batches: TestPayload[][] = [];
          const singles: TestPayload[] = [];
          const queueName = `{test/gqmain/mixed-${crypto.randomUUID().slice(0, 8)}}`;
          const queue = createQueue(
            async (p) => {
              singles.push(p);
            },
            {
              name: queueName,
              processBatch: async (ps) => {
                batches.push(ps as TestPayload[]);
              },
              coalesceMaxBatch: () => 50,
              score: (p) => orderedScore(Number((p.id as string).slice(1))),
            },
          );
          await queue.waitUntilReady();

          const foreignRestagedBefore =
            await foreignSiblingsRestagedCount(queueName);

          await queue.sendBatch([
            { id: "j0", groupId: "group-a", value: "a", __jobName: "cmdA" },
            { id: "j1", groupId: "group-a", value: "b", __jobName: "cmdB" },
            { id: "j2", groupId: "group-a", value: "a", __jobName: "cmdA" },
          ] as unknown as TestPayload[]);

          await vi.waitFor(
            () => {
              const total =
                batches.reduce((n, b) => n + b.length, 0) + singles.length;
              expect(total).toBe(3);
            },
            { timeout: 30000, interval: 50 },
          );

          // A coalesced cmdA batch actually formed (j0 + j2 folded). Without this
          // the no-mix loop below is vacuously true on an empty `batches`, so the
          // "never mixes __jobName" invariant would never be exercised.
          const coalesced = batches.filter((b) => b.length >= 2);
          expect(coalesced.length).toBeGreaterThan(0);

          // The invariant: no coalesced batch ever contains two distinct job names.
          for (const batch of batches) {
            const names = new Set(
              batch.map((p) => (p as Record<string, unknown>).__jobName),
            );
            expect(names.size).toBe(1);
          }

          // The foreign sibling (cmdB) was drained out of the cmdA group and
          // processed via its own dispatch — proving restageDrainedSiblings ran
          // rather than the cmdB job being folded or dropped.
          const cmdBProcessed = [...batches.flat(), ...singles].some(
            (p) => (p as Record<string, unknown>).__jobName === "cmdB",
          );
          expect(cmdBProcessed).toBe(true);

          // Every job processed exactly once — the foreign sibling was restaged,
          // not lost.
          const allIds = [...batches.flat(), ...singles].map((p) => p.id);
          expect(new Set(allIds).size).toBe(3);

          // The mixed-command restage is counted distinctly from the
          // batch-failure restage paths (ADR-066 pillar 2): exactly the one
          // foreign cmdB sibling was recorded against this queue.
          expect(await foreignSiblingsRestagedCount(queueName)).toBe(
            foreignRestagedBefore + 1,
          );
        });
      });
    });
  },
);
