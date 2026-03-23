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
    ): GroupQueueProcessor<TestPayload> {
      const queue = new GroupQueueProcessor<TestPayload>(
        createQueueDefinition({ process: processFn, ...overrides }),
        redis,
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
            { timeout: 10000, interval: 50 },
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
            { timeout: 10000, interval: 50 },
          );

          // Different groups should have been processed concurrently
          expect(peakConcurrency).toBe(2);
          expect(processedGroups).toContain("group-alpha");
          expect(processedGroups).toContain("group-beta");
        });
      });
    });
  },
);
