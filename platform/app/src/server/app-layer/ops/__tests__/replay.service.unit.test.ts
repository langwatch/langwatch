import type {
  BuiltPipeline,
  Registry,
  ReplayReport,
  ReplayRequest,
} from "@langwatch/event-sourcing";
import { describe, expect, it, vi } from "vitest";
import {
  LOCK_REFRESH_INTERVAL_MS,
  type ReplayEngine,
  ReplayService,
} from "../replay.service";
import {
  IDLE_STATUS,
  type ReplayHistoryEntry,
  type ReplayRepository,
  type ReplayStatus,
} from "../repositories/replay.repository";

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

const registry = {
  all: () => [
    {
      aggregateType: "trace",
      pipeline: {
        name: "trace",
        folds: { traceSummary: {} },
        maps: {},
      } as unknown as BuiltPipeline,
    },
    {
      aggregateType: "langy_conversation",
      pipeline: {
        name: "langy_conversation",
        folds: { langyConversationState: {} },
        maps: {},
      } as unknown as BuiltPipeline,
    },
  ],
} as unknown as Registry;

const NO_EVENTS: ReplayReport = {
  events: 0,
  applied: 0,
  skippedByVersion: 0,
};

function engineWith(
  replay: (request: ReplayRequest) => Promise<ReplayReport>,
): ReplayEngine {
  return { registry, replay: vi.fn(replay) };
}

describe("ops ReplayService", () => {
  describe("given projections owned by different pipelines", () => {
    describe("when a run selects one of them", () => {
      it("replays the aggregate type that declares it, once per tenant", async () => {
        const repo = createFakeRepo();
        const seen: ReplayRequest[] = [];
        const service = new ReplayService(
          repo,
          engineWith(async (request) => {
            seen.push(request);
            return { events: 3, applied: 3, skippedByVersion: 0 };
          }),
        );

        await service.startReplay({
          projectionNames: ["langyConversationState"],
          since: "2026-01-01",
          tenantIds: ["project_1", "project_2"],
          description: "state rebuild",
          userName: "tester",
        });

        await vi.waitFor(async () => {
          expect((await service.getStatus()).state).toBe("completed");
        });
        expect(seen).toEqual([
          expect.objectContaining({
            tenantId: "project_1",
            aggregateType: "langy_conversation",
            projections: ["langyConversationState"],
          }),
          expect.objectContaining({
            tenantId: "project_2",
            aggregateType: "langy_conversation",
          }),
        ]);
        expect((await service.getStatus()).eventsProcessed).toBe(6);
      });
    });
  });

  describe("given no tenant was named", () => {
    describe("when the run starts", () => {
      it("fails rather than scanning the log across every tenant", async () => {
        const repo = createFakeRepo();
        const replay = vi.fn(async () => NO_EVENTS);
        const service = new ReplayService(repo, engineWith(replay));

        await service.startReplay({
          projectionNames: ["traceSummary"],
          since: "2026-01-01",
          tenantIds: [],
          description: "unit",
          userName: "tester",
        });

        await vi.waitFor(async () => {
          expect((await service.getStatus()).state).toBe("failed");
        });
        expect(replay).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a projection no registered pipeline declares", () => {
    describe("when the run starts", () => {
      it("fails instead of replaying nothing silently", async () => {
        const repo = createFakeRepo();
        const service = new ReplayService(
          repo,
          engineWith(async () => NO_EVENTS),
        );

        await service.startReplay({
          projectionNames: ["gone"],
          since: "2026-01-01",
          tenantIds: ["project_1"],
          description: "unit",
          userName: "tester",
        });

        await vi.waitFor(async () => {
          const status = await service.getStatus();
          expect(status.state).toBe("failed");
          expect(status.error).toBe("No matching projections found");
        });
      });
    });
  });

  describe("given a slice reporting nothing for longer than the lock refresh interval", () => {
    describe("when the heartbeat interval elapses during the replay call", () => {
      it("refreshes the lock from the standalone timer", async () => {
        vi.useFakeTimers();
        try {
          const repo = createFakeRepo();
          let finishRun!: () => void;
          const runGate = new Promise<void>((resolve) => {
            finishRun = resolve;
          });
          const service = new ReplayService(
            repo,
            engineWith(async () => {
              await runGate;
              return { events: 5000, applied: 5000, skippedByVersion: 0 };
            }),
          );

          const { runId } = await service.startReplay({
            projectionNames: ["traceSummary"],
            since: "2026-01-01",
            tenantIds: ["project_1"],
            description: "unit",
            userName: "tester",
          });

          // Let executeReplay reach the replay call and arm the heartbeat.
          await vi.advanceTimersByTimeAsync(0);
          expect(repo.refreshLock).not.toHaveBeenCalled();

          // With the slice reporting nothing, only the standalone timer can
          // keep the lock alive.
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
            expect((await service.getStatus()).state).toBe("completed");
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
          const service = new ReplayService(
            repo,
            engineWith(async () => NO_EVENTS),
          );

          await service.startReplay({
            projectionNames: ["traceSummary"],
            since: "2026-01-01",
            tenantIds: ["project_1"],
            description: "unit",
            userName: "tester",
          });

          await vi.advanceTimersByTimeAsync(0);
          await vi.waitFor(async () => {
            expect((await service.getStatus()).state).toBe("completed");
          });

          const refreshesAtFinish = (
            repo.refreshLock as ReturnType<typeof vi.fn>
          ).mock.calls.length;
          await vi.advanceTimersByTimeAsync(LOCK_REFRESH_INTERVAL_MS * 3);
          expect(
            (repo.refreshLock as ReturnType<typeof vi.fn>).mock.calls.length,
          ).toBe(refreshesAtFinish);
        } finally {
          vi.useRealTimers();
        }
      });
    });
  });

  describe("given a cancel requested mid-run", () => {
    describe("when the next slice boundary checks the flag", () => {
      it("finalizes the run as cancelled", async () => {
        const repo = createFakeRepo();
        const service = new ReplayService(
          repo,
          engineWith(async () => {
            await repo.setCancelled({ ttlSeconds: 3600 });
            return NO_EVENTS;
          }),
        );

        await service.startReplay({
          projectionNames: ["traceSummary"],
          since: "2026-01-01",
          tenantIds: ["project_1", "project_2"],
          description: "unit",
          userName: "tester",
        });

        await vi.waitFor(async () => {
          expect((await service.getStatus()).state).toBe("cancelled");
        });
        const [entry] = await service.getHistory();
        expect(entry?.state).toBe("cancelled");
      });
    });
  });

  describe("given a replay whose lock was taken over by another run", () => {
    describe("when the stale run finishes", () => {
      it("does not overwrite the new holder's status", async () => {
        const repo = createFakeRepo();
        let finishRun!: () => void;
        const runGate = new Promise<void>((resolve) => {
          finishRun = resolve;
        });
        const service = new ReplayService(
          repo,
          engineWith(async () => {
            await runGate;
            return NO_EVENTS;
          }),
        );

        await service.startReplay({
          projectionNames: ["traceSummary"],
          since: "2026-01-01",
          tenantIds: ["project_1"],
          description: "stale",
          userName: "tester",
        });

        vi.mocked(repo.getLockHolder).mockResolvedValue("someone-else");
        finishRun();

        await vi.waitFor(() => {
          expect(repo.releaseLock).toHaveBeenCalled();
        });
        expect((await service.getStatus()).state).toBe("running");
        expect(await service.getHistory()).toEqual([]);
      });
    });
  });

  describe("given a replay whose lock expired with no successor", () => {
    describe("when the run finishes successfully", () => {
      it("still finalizes the run as completed", async () => {
        const repo = createFakeRepo();
        let finishRun!: () => void;
        const runGate = new Promise<void>((resolve) => {
          finishRun = resolve;
        });
        const service = new ReplayService(
          repo,
          engineWith(async () => {
            await runGate;
            return { events: 9, applied: 9, skippedByVersion: 0 };
          }),
        );

        await service.startReplay({
          projectionNames: ["traceSummary"],
          since: "2026-01-01",
          tenantIds: ["project_1"],
          description: "expired",
          userName: "tester",
        });

        vi.mocked(repo.getLockHolder).mockResolvedValue(null);
        finishRun();

        await vi.waitFor(async () => {
          expect((await service.getStatus()).state).toBe("completed");
        });
      });
    });
  });
});
