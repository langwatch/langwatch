import { describe, expect, it, vi } from "vitest";
import { OpsMetricsCollector } from "../metrics-collector";
import type { QueueRepository } from "../repositories/queue.repository";

function createMockRedis() {
  return {
    pipeline: vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      zadd: vi.fn(),
      zremrangebyscore: vi.fn(),
      smembers: vi.fn(),
    }),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    info: vi.fn().mockResolvedValue(""),
    smembers: vi.fn().mockResolvedValue([]),
    zrange: vi.fn().mockResolvedValue([]),
  } as unknown as import("ioredis").default;
}

function createMockRepo(
  overrides: Partial<QueueRepository> = {},
): QueueRepository {
  return {
    discoverQueueNames: vi.fn().mockResolvedValue([]),
    scanQueues: vi.fn().mockResolvedValue([]),
    getGroupJobs: vi.fn().mockResolvedValue({ jobs: [], total: 0 }),
    getBlockedSummary: vi
      .fn()
      .mockResolvedValue({ totalBlocked: 0, clusters: [] }),
    unblockGroup: vi.fn().mockResolvedValue({ wasBlocked: false }),
    unblockAll: vi.fn().mockResolvedValue({ unblockedCount: 0 }),
    drainGroup: vi.fn().mockResolvedValue({ jobsRemoved: 0 }),
    pausePipeline: vi.fn().mockResolvedValue(undefined),
    unpausePipeline: vi.fn().mockResolvedValue(undefined),
    retryBlocked: vi.fn().mockResolvedValue({ wasBlocked: false }),
    listPausedKeys: vi.fn().mockResolvedValue([]),
    moveToDlq: vi.fn().mockResolvedValue({ jobsMoved: 0 }),
    moveAllBlockedToDlq: vi
      .fn()
      .mockResolvedValue({ movedCount: 0, jobsMoved: 0 }),
    replayFromDlq: vi.fn().mockResolvedValue({ jobsReplayed: 0 }),
    replayAllFromDlq: vi
      .fn()
      .mockResolvedValue({ replayedCount: 0, jobsReplayed: 0 }),
    canaryRedrive: vi
      .fn()
      .mockResolvedValue({ redrivenCount: 0, groupIds: [] }),
    canaryUnblock: vi
      .fn()
      .mockResolvedValue({ unblockedCount: 0, groupIds: [] }),
    listDlqGroups: vi.fn().mockResolvedValue([]),
    drainAllBlockedPreview: vi
      .fn()
      .mockResolvedValue({ totalAffected: 0, byPipeline: [], byError: [] }),
    pauseTenant: vi.fn().mockResolvedValue(undefined),
    unpauseTenant: vi.fn().mockResolvedValue(undefined),
    listPausedTenants: vi.fn().mockResolvedValue([]),
    drainTenant: vi
      .fn()
      .mockResolvedValue({ groupsDrained: 0, jobsDrained: 0 }),
    reconcileTotalPending: vi.fn().mockResolvedValue(null),
    readPublishedPendingDrift: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

/**
 * Drive the private reconcile through the public discovery path, then read the
 * dashboard the way the UI does.
 */
const runReconcile = async (queueRepo: QueueRepository) => {
  const collector = new OpsMetricsCollector({
    redis: createMockRedis(),
    queueRepo,
  });
  await collector.discoverQueues();
  // Access via bracket notation to avoid exposing a test-only public API.
  await (
    collector as unknown as { reconcilePending(): Promise<void> }
  ).reconcilePending();
  return collector.getDashboardData().pendingDrift;
};

describe("OpsMetricsCollector", () => {
  describe("reconcilePending()", () => {
    describe("given this instance measured the drift itself", () => {
      describe("when reconcilePending runs", () => {
        /**
         * The published figure and the locally measured one are deliberately
         * different here. Reporting the local sum (40) would pass on a test
         * that used matching numbers, so they are kept apart to make the two
         * outcomes distinguishable.
         */
        it("reports the published drift rather than its own measurement", async () => {
          const queueRepo = createMockRepo({
            discoverQueueNames: vi
              .fn()
              .mockResolvedValue(["queue-alpha", "queue-beta"]),
            reconcileTotalPending: vi
              .fn()
              .mockResolvedValueOnce({
                counter: 130,
                groundTruth: 100,
                drift: 30,
              })
              .mockResolvedValueOnce({
                counter: 40,
                groundTruth: 50,
                drift: -10,
              }),
            readPublishedPendingDrift: vi.fn().mockResolvedValue(97),
          });

          expect(await runReconcile(queueRepo)).toBe(97);
        });
      });
    });

    // The reconcile is single-flighted, so on any cycle most instances win no
    // marker and measure nothing. Reporting what they measured would report 0
    // drift for a queue that has plenty.
    describe("given this instance won no single-flight marker", () => {
      describe("when reconcilePending runs", () => {
        it("still reports the drift another instance published", async () => {
          const queueRepo = createMockRepo({
            discoverQueueNames: vi
              .fn()
              .mockResolvedValue(["queue-alpha", "queue-beta"]),
            reconcileTotalPending: vi.fn().mockResolvedValue(null),
            readPublishedPendingDrift: vi.fn().mockResolvedValue(42),
          });

          expect(await runReconcile(queueRepo)).toBe(42);
        });
      });
    });

    describe("given every queue reports no drift", () => {
      describe("when reconcilePending runs", () => {
        it("reports zero", async () => {
          const queueRepo = createMockRepo({
            discoverQueueNames: vi.fn().mockResolvedValue(["queue-alpha"]),
            reconcileTotalPending: vi
              .fn()
              .mockResolvedValue({ counter: 5, groundTruth: 5, drift: 0 }),
            readPublishedPendingDrift: vi.fn().mockResolvedValue(0),
          });

          expect(await runReconcile(queueRepo)).toBe(0);
        });
      });
    });
  });
});
