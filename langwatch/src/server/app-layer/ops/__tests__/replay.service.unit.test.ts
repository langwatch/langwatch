import { describe, expect, it, vi } from "vitest";
import { ReplayService } from "../replay.service";
import {
  IDLE_STATUS,
  type ReplayHistoryEntry,
  type ReplayRepository,
  type ReplayStatus,
} from "../repositories/replay.repository";
import { createReplayRuntime } from "~/server/event-sourcing/replay/replayPreset";
import type { ReplayCallbacks } from "~/server/event-sourcing/replay/types";

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

function stubRuntime(
  replayOptimized: (
    config: unknown,
    callbacks?: ReplayCallbacks,
  ) => Promise<{
    aggregatesReplayed: number;
    totalEvents: number;
    batchErrors: number;
    firstError?: string;
  }>,
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
    service: { replayOptimized } as never,
    close: vi.fn(async () => undefined),
  } as never);
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
        await vi.waitFor(() => {
          expect(mockedCreateReplayRuntime).toHaveBeenCalled();
        });
        await new Promise((resolve) => setTimeout(resolve, 20));

        const status = await service.getStatus();
        expect(status.state).toBe("running");
      });
    });
  });
});
