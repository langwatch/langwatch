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

function createMockRepo(overrides: Partial<QueueRepository> = {}): QueueRepository {
  return {
    discoverQueueNames: vi.fn().mockResolvedValue([]),
    scanQueues: vi.fn().mockResolvedValue([]),
    getGroupJobs: vi.fn().mockResolvedValue({ jobs: [], total: 0 }),
    getBlockedSummary: vi.fn().mockResolvedValue({ totalBlocked: 0, clusters: [] }),
    unblockGroup: vi.fn().mockResolvedValue({ wasBlocked: false }),
    unblockAll: vi.fn().mockResolvedValue({ unblockedCount: 0 }),
    drainGroup: vi.fn().mockResolvedValue({ jobsRemoved: 0 }),
    pausePipeline: vi.fn().mockResolvedValue(undefined),
    unpausePipeline: vi.fn().mockResolvedValue(undefined),
    retryBlocked: vi.fn().mockResolvedValue({ wasBlocked: false }),
    listPausedKeys: vi.fn().mockResolvedValue([]),
    moveToDlq: vi.fn().mockResolvedValue({ jobsMoved: 0 }),
    moveAllBlockedToDlq: vi.fn().mockResolvedValue({ movedCount: 0, jobsMoved: 0 }),
    replayFromDlq: vi.fn().mockResolvedValue({ jobsReplayed: 0 }),
    replayAllFromDlq: vi.fn().mockResolvedValue({ replayedCount: 0, jobsReplayed: 0 }),
    canaryRedrive: vi.fn().mockResolvedValue({ redrivenCount: 0, groupIds: [] }),
    canaryUnblock: vi.fn().mockResolvedValue({ unblockedCount: 0, groupIds: [] }),
    listDlqGroups: vi.fn().mockResolvedValue([]),
    drainAllBlockedPreview: vi.fn().mockResolvedValue({ totalAffected: 0, byPipeline: [], byError: [] }),
    pauseTenant: vi.fn().mockResolvedValue(undefined),
    unpauseTenant: vi.fn().mockResolvedValue(undefined),
    listPausedTenants: vi.fn().mockResolvedValue([]),
    drainTenant: vi.fn().mockResolvedValue({ groupsDrained: 0, jobsDrained: 0 }),
    reconcileTotalPending: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe("OpsMetricsCollector", () => {
  describe("reconcilePending()", () => {
    describe("given two queues with opposing drifts", () => {
      describe("when reconcilePending runs", () => {
        /**
         * Opposing per-queue drifts (+30 and -10) must not cancel each other.
         * The health signal accumulates absolute values so the dashboard tile
         * always shows total magnitude of drift regardless of direction.
         */
        it("accumulates absolute drift values so opposing drifts do not cancel", async () => {
          const queueRepo = createMockRepo({
            discoverQueueNames: vi.fn().mockResolvedValue(["queue-alpha", "queue-beta"]),
            reconcileTotalPending: vi.fn()
              .mockResolvedValueOnce({ counter: 130, groundTruth: 100, drift: 30 })
              .mockResolvedValueOnce({ counter: 40, groundTruth: 50, drift: -10 }),
          });

          const collector = new OpsMetricsCollector({
            redis: createMockRedis(),
            queueRepo,
          });

          // Populate groupQueueNames via the public discovery path
          await collector.discoverQueues();

          // Call the private method through the public reconcile path.
          // Access via bracket notation to avoid exposing a test-only public API.
          await (collector as unknown as { reconcilePending(): Promise<void> }).reconcilePending();

          expect(collector.getDashboardData().pendingDrift).toBe(40);
        });
      });
    });
  });
});
