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
  let cancelled = false;
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
    isCancelled: vi.fn(async () => cancelled),
    setCancelled: vi.fn(async () => {
      cancelled = true;
    }),
    clearCancelFlag: vi.fn(async () => {
      cancelled = false;
    }),
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
    stateProjections: [],
    service: { replayOptimized } as StubbedRuntime["service"],
    close: vi.fn(async () => undefined),
  } satisfies StubbedRuntime);
}

function stubStateRuntime(
  replay: StubbedRuntime["service"]["replay"],
) {
  const replayOptimized = vi.fn();
  mockedCreateReplayRuntime.mockReturnValue({
    projections: [],
    mapProjections: [],
    stateProjections: [
      {
        projectionName: "langyConversationState",
        pipelineName: "langy_conversation_processing",
        aggregateType: "langy_conversation",
        source: "pipeline",
        pauseKey:
          "langy_conversation_processing/stateProjection/langyConversationState",
        kind: "state",
        definition: {} as never,
      },
    ],
    service: { replay, replayOptimized } as unknown as StubbedRuntime["service"],
    close: vi.fn(async () => undefined),
  } satisfies StubbedRuntime);
  return { replayOptimized };
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
  it("routes operational state projections through the safe normal replay path", async () => {
    const repo = createFakeRepo();
    const service = new ReplayService(repo);
    const replay = vi.fn(async () => ({
      aggregatesReplayed: 1,
      totalEvents: 3,
      batchErrors: 0,
    }));
    const { replayOptimized } = stubStateRuntime(replay);

    await service.startReplay({
      projectionNames: ["langyConversationState"],
      since: "2026-01-01",
      tenantIds: ["project_1"],
      description: "state rebuild",
      userName: "tester",
    });

    await vi.waitFor(async () => {
      expect((await service.getStatus()).state).toBe("completed");
    });
    expect(replay).toHaveBeenCalledWith(
      expect.objectContaining({
        projections: [],
        mapProjections: [],
        stateProjections: [
          expect.objectContaining({
            projectionName: "langyConversationState",
          }),
        ],
      }),
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );
    expect(replayOptimized).not.toHaveBeenCalled();
  });

  describe("given a single batch phase emitting no callbacks for longer than the lock refresh interval", () => {
    describe("when the heartbeat interval elapses during the runtime call", () => {
      it("refreshes the lock from the standalone timer", async () => {
        vi.useFakeTimers();
        try {
          const repo = createFakeRepo();
          const service = new ReplayService(repo);

          let finishRun!: () => void;
          const runGate = new Promise<void>((resolve) => {
            finishRun = resolve;
          });

          // The stub never emits progress and never completes a batch — a
          // silent drain wait / ClickHouse load longer than the interval.
          stubRuntime(async () => {
            await runGate;
            return { aggregatesReplayed: 1000, totalEvents: 5000, batchErrors: 0 };
          });

          const { runId } = await service.startReplay({
            projectionNames: ["traceSummary"],
            since: "2026-01-01",
            tenantIds: [],
            description: "unit",
            userName: "tester",
          });

          // Let executeReplay reach the runtime call and arm the heartbeat.
          await vi.advanceTimersByTimeAsync(0);
          expect(repo.refreshLock).not.toHaveBeenCalled();

          // With NO progress emits and NO batch completions, only the
          // standalone timer can keep the lock alive.
          await vi.advanceTimersByTimeAsync(LOCK_REFRESH_INTERVAL_MS);
          expect(repo.refreshLock).toHaveBeenCalledTimes(1);
          expect(repo.refreshLock).toHaveBeenCalledWith({
            runId,
            ttlSeconds: 3600,
          });

          await vi.advanceTimersByTimeAsync(LOCK_REFRESH_INTERVAL_MS);
          expect(repo.refreshLock).toHaveBeenCalledTimes(2);

          finishRun();
          await vi.waitFor(async () => {
            const status = await service.getStatus();
            expect(status.state).toBe("completed");
          });
        } finally {
          vi.useRealTimers();
        }
      });
    });

    describe("when the run has finished", () => {
      it("stops the heartbeat so no further refreshes fire", async () => {
        vi.useFakeTimers();
        try {
          const repo = createFakeRepo();
          const service = new ReplayService(repo);

          let finishRun!: () => void;
          const runGate = new Promise<void>((resolve) => {
            finishRun = resolve;
          });

          stubRuntime(async () => {
            await runGate;
            return { aggregatesReplayed: 1000, totalEvents: 5000, batchErrors: 0 };
          });

          await service.startReplay({
            projectionNames: ["traceSummary"],
            since: "2026-01-01",
            tenantIds: [],
            description: "unit",
            userName: "tester",
          });

          // Heartbeat fires while the run is in flight.
          await vi.advanceTimersByTimeAsync(LOCK_REFRESH_INTERVAL_MS);
          expect(repo.refreshLock).toHaveBeenCalledTimes(1);

          finishRun();
          await vi.waitFor(async () => {
            const status = await service.getStatus();
            expect(status.state).toBe("completed");
          });

          // The interval is cleared with the run — advancing well past
          // several more intervals must not refresh again.
          await vi.advanceTimersByTimeAsync(LOCK_REFRESH_INTERVAL_MS * 3);
          expect(repo.refreshLock).toHaveBeenCalledTimes(1);
        } finally {
          vi.useRealTimers();
        }
      });
    });

    describe("when a lock refresh rejects transiently", () => {
      it("keeps the run alive and refreshes again on the next interval", async () => {
        vi.useFakeTimers();
        try {
          const repo = createFakeRepo();
          const service = new ReplayService(repo);

          // First refresh fails (e.g. a Redis hiccup); later ones succeed
          // via the fake's real implementation.
          vi.mocked(repo.refreshLock).mockRejectedValueOnce(
            new Error("redis hiccup"),
          );

          let finishRun!: () => void;
          const runGate = new Promise<void>((resolve) => {
            finishRun = resolve;
          });

          stubRuntime(async () => {
            await runGate;
            return { aggregatesReplayed: 1000, totalEvents: 5000, batchErrors: 0 };
          });

          await service.startReplay({
            projectionNames: ["traceSummary"],
            since: "2026-01-01",
            tenantIds: [],
            description: "unit",
            userName: "tester",
          });

          await vi.advanceTimersByTimeAsync(0);

          // First tick rejects — the run must survive it and stay running.
          await vi.advanceTimersByTimeAsync(LOCK_REFRESH_INTERVAL_MS);
          expect(repo.refreshLock).toHaveBeenCalledTimes(1);
          expect((await service.getStatus()).state).toBe("running");

          // Second tick refreshes normally.
          await vi.advanceTimersByTimeAsync(LOCK_REFRESH_INTERVAL_MS);
          expect(repo.refreshLock).toHaveBeenCalledTimes(2);

          finishRun();
          await vi.waitFor(async () => {
            const status = await service.getStatus();
            expect(status.state).toBe("completed");
          });
        } finally {
          vi.useRealTimers();
        }
      });
    });
  });

  describe("given a cancel requested during a callback-silent batch phase", () => {
    describe("when the heartbeat tick polls the cancel flag", () => {
      it("picks up the cancellation and finalizes the run as cancelled", async () => {
        vi.useFakeTimers();
        try {
          const repo = createFakeRepo();
          const service = new ReplayService(repo);

          let proceedToProgress!: () => void;
          const progressGate = new Promise<void>((resolve) => {
            proceedToProgress = resolve;
          });

          stubRuntime(async (_config, callbacks) => {
            // Callback-silent phase: nothing emits until the gate opens.
            await progressGate;
            callbacks?.onProgress?.(buildProgress());
            return { aggregatesReplayed: 1000, totalEvents: 5000, batchErrors: 0 };
          });

          await service.startReplay({
            projectionNames: ["traceSummary"],
            since: "2026-01-01",
            tenantIds: [],
            description: "unit",
            userName: "tester",
          });
          await vi.advanceTimersByTimeAsync(0);

          // Cancel lands while the batch phase emits no callbacks; the flag
          // TTL matches the lock TTL so it cannot expire between polls.
          await service.cancelReplay();
          expect(repo.setCancelled).toHaveBeenCalledWith({
            ttlSeconds: 3600,
          });

          // Only the heartbeat can observe the flag during the silent phase
          // (one isCancelled call at start + one from the heartbeat tick).
          await vi.advanceTimersByTimeAsync(LOCK_REFRESH_INTERVAL_MS);
          expect(repo.isCancelled).toHaveBeenCalledTimes(2);

          // The next (single) progress emit sees the flag synchronously and
          // aborts — its own async cancel poll could not have resolved yet,
          // so only the heartbeat's pickup explains the abort.
          proceedToProgress();
          await vi.waitFor(async () => {
            const status = await service.getStatus();
            expect(status.state).toBe("cancelled");
          });
          expect(repo.pushToHistory).toHaveBeenCalledWith({
            entry: expect.objectContaining({ state: "cancelled" }),
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
        vi.useFakeTimers();
        try {
          const repo = createFakeRepo();
          const service = new ReplayService(repo);
          let hasResumedAfterAbort = false;

          let proceedToProgress!: () => void;
          const progressGate = new Promise<void>((resolve) => {
            proceedToProgress = resolve;
          });

          stubRuntime(async (_config, callbacks) => {
            // Simulate expiry + takeover: this run no longer holds the lock.
            await repo.releaseLock({ runId: (await repo.getLockHolder())! });
            // Wait until the heartbeat has refreshed against the lost lock.
            await progressGate;
            callbacks?.onProgress?.(buildProgress());
            hasResumedAfterAbort = true;
            return { aggregatesReplayed: 2000, totalEvents: 10000, batchErrors: 0 };
          });

          await service.startReplay({
            projectionNames: ["traceSummary"],
            since: "2026-01-01",
            tenantIds: [],
            description: "unit",
            userName: "tester",
          });

          // Let the stub run its takeover simulation, then fire the
          // standalone heartbeat: refreshLock resolves false and flags the
          // run for cancellation.
          await vi.advanceTimersByTimeAsync(0);
          await vi.advanceTimersByTimeAsync(LOCK_REFRESH_INTERVAL_MS);
          expect(repo.refreshLock).toHaveBeenCalledTimes(1);

          proceedToProgress();
          await vi.waitFor(async () => {
            const status = await service.getStatus();
            expect(status.state).toBe("cancelled");
          });

          // The throw from onProgress must have aborted the stale run before
          // it could keep replaying alongside the new lock holder.
          expect(hasResumedAfterAbort).toBe(false);
          expect(repo.pushToHistory).toHaveBeenCalledWith({
            entry: expect.objectContaining({ state: "cancelled" }),
          });

          // The runtime threw — the finally must have cleared the heartbeat,
          // so further intervals never touch the lock again.
          await vi.advanceTimersByTimeAsync(LOCK_REFRESH_INTERVAL_MS * 3);
          expect(repo.refreshLock).toHaveBeenCalledTimes(1);
        } finally {
          vi.useRealTimers();
        }
      });
    });

    describe("when further heartbeat intervals elapse after the lock is lost", () => {
      it("stops the heartbeat after the first lost-lock detection", async () => {
        vi.useFakeTimers();
        try {
          const repo = createFakeRepo();
          const service = new ReplayService(repo);

          let finishRun!: () => void;
          const runGate = new Promise<void>((resolve) => {
            finishRun = resolve;
          });

          stubRuntime(async () => {
            // Lock expires with no successor while the run is in flight.
            await repo.releaseLock({
              runId: (await repo.getLockHolder())!,
            });
            await runGate;
            return { aggregatesReplayed: 1, totalEvents: 1, batchErrors: 0 };
          });

          await service.startReplay({
            projectionNames: ["traceSummary"],
            since: "2026-01-01",
            tenantIds: [],
            description: "unit",
            userName: "tester",
          });
          await vi.advanceTimersByTimeAsync(0);

          // First tick detects the lost lock (warns once) and clears the
          // interval itself.
          await vi.advanceTimersByTimeAsync(LOCK_REFRESH_INTERVAL_MS);
          expect(repo.refreshLock).toHaveBeenCalledTimes(1);

          // Three more intervals: no further refresh attempts, hence no
          // repeated lost-lock warnings.
          await vi.advanceTimersByTimeAsync(LOCK_REFRESH_INTERVAL_MS * 3);
          expect(repo.refreshLock).toHaveBeenCalledTimes(1);

          finishRun();
          await vi.waitFor(async () => {
            const status = await service.getStatus();
            expect(status.state).toBe("completed");
          });
        } finally {
          vi.useRealTimers();
        }
      });
    });
  });

  describe("given a replay whose lock was taken over by another run", () => {
    describe("when the stale run finishes", () => {
      it("does not overwrite the new holder's status", async () => {
        const repo = createFakeRepo();
        const service = new ReplayService(repo);

        stubRuntime(async () => {
          // Simulate the lock being lost mid-run: it expires AND a new run
          // acquires it — the successor now owns the status row.
          await repo.releaseLock({
            runId: (await repo.getLockHolder())!,
          });
          await repo.acquireLock({
            runId: "successor-run",
            ttlSeconds: 3600,
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

  describe("given a replay whose lock expired with no successor", () => {
    describe("when the run finishes successfully", () => {
      it("still finalizes the run as completed", async () => {
        const repo = createFakeRepo();
        const service = new ReplayService(repo);

        stubRuntime(async () => {
          // Lock expired mid-run and nobody took over: holder is null.
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

        // No successor owns the status row, so the run must not be left
        // stuck in "running" — it finalizes as completed.
        await vi.waitFor(async () => {
          const status = await service.getStatus();
          expect(status.state).toBe("completed");
        });
        expect(repo.pushToHistory).toHaveBeenCalledWith({
          entry: expect.objectContaining({ state: "completed" }),
        });
      });
    });
  });
});
