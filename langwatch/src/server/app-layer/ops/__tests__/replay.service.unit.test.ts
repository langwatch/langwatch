import { describe, expect, it, vi } from "vitest";
import { LOCK_REFRESH_INTERVAL_MS, ReplayService } from "../replay.service";
import {
  IDLE_STATUS,
  type ReplayHistoryEntry,
  type ReplayRepository,
  type ReplayStatus,
} from "../repositories/replay.repository";
import { createReplayRuntime } from "~/server/event-sourcing/replay/replayPreset";
import type { ReplayProgress } from "~/server/event-sourcing/replay/types";

vi.mock("~/env.mjs", () => ({
  env: { REDIS_URL: "redis://unit-test" },
}));

vi.mock("~/server/event-sourcing/replay/replayPreset", () => ({
  createReplayRuntime: vi.fn(),
}));

const mockedCreateReplayRuntime = vi.mocked(createReplayRuntime);

/** In-memory ReplayRepository double with spy-wrapped lock methods. */
function createFakeRepo() {
  let status: ReplayStatus = { ...IDLE_STATUS };
  let lockHolder: string | null = null;
  const history: ReplayHistoryEntry[] = [];

  const repo: ReplayRepository = {
    getStatus: vi.fn(async () => status),
    writeStatus: vi.fn(async (params: { status: ReplayStatus }) => {
      status = params.status;
    }),
    acquireLock: vi.fn(async (params: { runId: string }) => {
      if (lockHolder) return false;
      lockHolder = params.runId;
      return true;
    }),
    refreshLock: vi.fn(async (params: { runId: string }) => {
      return lockHolder === params.runId;
    }),
    releaseLock: vi.fn(async (params: { runId: string }) => {
      if (lockHolder === params.runId) lockHolder = null;
    }),
    getLockHolder: vi.fn(async () => lockHolder),
    isCancelled: vi.fn(async () => false),
    setCancelled: vi.fn(async () => undefined),
    clearCancelFlag: vi.fn(async () => undefined),
    pushToHistory: vi.fn(async (params: { entry: ReplayHistoryEntry }) => {
      history.push(params.entry);
    }),
    getHistory: vi.fn(async () => history),
  };

  return repo;
}

type StubbedRuntime = ReturnType<typeof createReplayRuntime>;

function stubRuntime(
  replayOptimized: StubbedRuntime["service"]["replayOptimized"],
) {
  mockedCreateReplayRuntime.mockReturnValue({
    projections: [
      {
        projectionName: "traceSummary",
        pipelineName: "trace_processing",
        aggregateType: "trace",
        source: "pipeline",
        pauseKey: "trace_processing/projection/traceSummary",
        kind: "fold",
        definition: {} as never,
      },
    ],
    mapProjections: [],
    service: { replayOptimized } as StubbedRuntime["service"],
    close: vi.fn(async () => undefined),
  } satisfies StubbedRuntime);
}

function buildProgress(
  overrides: Partial<ReplayProgress> = {},
): ReplayProgress {
  return {
    phase: "replaying",
    currentProjectionName: "traceSummary",
    currentProjectionKind: "fold",
    currentProjectionIndex: 0,
    totalProjections: 1,
    totalAggregates: 1000,
    tenantCount: 1,
    currentBatch: 1,
    totalBatches: 1,
    batchAggregates: 1000,
    batchPhase: "replay",
    batchEventsProcessed: 0,
    aggregatesCompleted: 0,
    totalEventsReplayed: 0,
    elapsedSec: 0,
    skippedCount: 0,
    batchErrors: 0,
    ...overrides,
  };
}

describe("ops ReplayService", () => {
  describe("given a replay run spanning multiple batches", () => {
    describe("when each batch completes", () => {
      it("refreshes the replay lock at least once per batch", async () => {
        const repo = createFakeRepo();
        const service = new ReplayService(repo);

        stubRuntime(async (_config, callbacks) => {
          for (let batchNum = 1; batchNum <= 3; batchNum++) {
            callbacks?.onBatchComplete?.({
              projectionName: "traceSummary",
              projectionKind: "fold",
              batchNum,
              totalBatches: 3,
              aggregatesInBatch: 1000,
              eventsInBatch: 5000,
              durationSec: 1,
            });
          }
          return { aggregatesReplayed: 3000, totalEvents: 15000, batchErrors: 0 };
        });

        const { runId } = await service.startReplay({
          projectionNames: ["traceSummary"],
          since: "2026-01-01",
          tenantIds: [],
          description: "unit",
          userName: "tester",
        });

        await vi.waitFor(async () => {
          const status = await service.getStatus();
          expect(status.state).toBe("completed");
        });

        // One refresh per completed batch keeps the 1h lock TTL from
        // expiring on multi-hour runs (expiry silently stopped progress
        // updates: lockHolder !== runId).
        expect(repo.refreshLock).toHaveBeenCalledTimes(3);
        expect(repo.refreshLock).toHaveBeenCalledWith({
          runId,
          ttlSeconds: 3600,
        });
      });
    });
  });

  describe("given a single batch running longer than the lock refresh interval", () => {
    describe("when progress is emitted after the interval elapses", () => {
      it("refreshes the lock from the time-gated progress path", async () => {
        vi.useFakeTimers();
        try {
          const repo = createFakeRepo();
          const service = new ReplayService(repo);

          stubRuntime(async (_config, callbacks) => {
            // First emit is inside the interval — must NOT refresh.
            callbacks?.onProgress?.(buildProgress());
            // Same batch keeps running past the refresh interval.
            vi.advanceTimersByTime(LOCK_REFRESH_INTERVAL_MS + 1_000);
            callbacks?.onProgress?.(buildProgress());
            return { aggregatesReplayed: 1000, totalEvents: 5000, batchErrors: 0 };
          });

          const { runId } = await service.startReplay({
            projectionNames: ["traceSummary"],
            since: "2026-01-01",
            tenantIds: [],
            description: "unit",
            userName: "tester",
          });

          await vi.waitFor(async () => {
            const status = await service.getStatus();
            expect(status.state).toBe("completed");
          });

          // No batch completions fired, so the single refresh can only have
          // come from the time-gated onProgress heartbeat.
          expect(repo.refreshLock).toHaveBeenCalledTimes(1);
          expect(repo.refreshLock).toHaveBeenCalledWith({
            runId,
            ttlSeconds: 3600,
          });
        } finally {
          vi.useRealTimers();
        }
      });
    });
  });

  describe("given a replay whose lock refresh reports the lock is no longer held", () => {
    describe("when the next progress emit runs its cancellation check", () => {
      it("aborts the stale run instead of continuing to replay", async () => {
        const repo = createFakeRepo();
        const service = new ReplayService(repo);
        let resumedAfterAbort = false;

        stubRuntime(async (_config, callbacks) => {
          // Simulate expiry + takeover: this run no longer holds the lock.
          await repo.releaseLock({ runId: (await repo.getLockHolder())! });
          // The batch-complete heartbeat now refreshes against a lost lock.
          callbacks?.onBatchComplete?.({
            projectionName: "traceSummary",
            projectionKind: "fold",
            batchNum: 1,
            totalBatches: 2,
            aggregatesInBatch: 1000,
            eventsInBatch: 5000,
            durationSec: 1,
          });
          // Let the fire-and-forget refreshLock promise settle so the
          // abort flag is observed by the next progress emit.
          await new Promise((resolve) => setImmediate(resolve));
          callbacks?.onProgress?.(buildProgress());
          resumedAfterAbort = true;
          return { aggregatesReplayed: 2000, totalEvents: 10000, batchErrors: 0 };
        });

        await service.startReplay({
          projectionNames: ["traceSummary"],
          since: "2026-01-01",
          tenantIds: [],
          description: "unit",
          userName: "tester",
        });

        await vi.waitFor(async () => {
          const status = await service.getStatus();
          expect(status.state).toBe("cancelled");
        });

        // The throw from onProgress must have aborted the stale run before
        // it could keep replaying alongside the new lock holder.
        expect(resumedAfterAbort).toBe(false);
        expect(repo.pushToHistory).toHaveBeenCalledWith({
          entry: expect.objectContaining({ state: "cancelled" }),
        });
      });
    });
  });

  describe("given a replay whose lock was taken over by another run", () => {
    describe("when the stale run finishes", () => {
      it("does not overwrite the new holder's status", async () => {
        const repo = createFakeRepo();
        const service = new ReplayService(repo);

        stubRuntime(async () => {
          // Simulate the lock being lost mid-run (e.g. expiry + takeover).
          await repo.releaseLock({
            runId: (await repo.getLockHolder())!,
          });
          return { aggregatesReplayed: 1, totalEvents: 1, batchErrors: 0 };
        });

        await service.startReplay({
          projectionNames: ["traceSummary"],
          since: "2026-01-01",
          tenantIds: [],
          description: "unit",
          userName: "tester",
        });

        // The run must bail out without flipping state to completed.
        // executeReplay's finally always releases the lock, so the second
        // releaseLock call (the first is the stub's simulated takeover)
        // deterministically marks the stale run as finished.
        await vi.waitFor(() => {
          expect(repo.releaseLock).toHaveBeenCalledTimes(2);
        });

        const status = await service.getStatus();
        expect(status.state).toBe("running");
        expect(repo.pushToHistory).not.toHaveBeenCalled();
      });
    });
  });
});
