import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("~/server/app-layer/app", () => ({
  getApp: vi.fn(),
}));

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { getApp } from "~/server/app-layer/app";
import { archiveScenarioSetRuns } from "../[[...route]]/app";

describe("archiveScenarioSetRuns()", () => {
  let mockGetRunIdsForSet: Mock;
  let mockDeleteRun: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetRunIdsForSet = vi.fn();
    mockDeleteRun = vi.fn().mockResolvedValue(undefined);

    (getApp as Mock).mockReturnValue({
      simulations: {
        runs: {
          getRunIdsForSet: mockGetRunIdsForSet,
        },
        deleteRun: mockDeleteRun,
      },
    });
  });

  describe("when getRunIdsForSet returns N runs", () => {
    it("dispatches deleteRun for each and returns archived=N, failed=0, scenarioSetId, hasMore=false", async () => {
      const runIds = ["run-1", "run-2", "run-3"];
      mockGetRunIdsForSet.mockResolvedValue({ runIds, reachedCap: false });

      const result = await archiveScenarioSetRuns("project-a", "set-a");

      expect(result.archived).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.scenarioSetId).toBe("set-a");
      expect(result.hasMore).toBe(false);
      expect(mockDeleteRun).toHaveBeenCalledTimes(3);
    });
  });

  describe("when one deleteRun rejects", () => {
    it("does not short-circuit; returns archived=N-1, failed=1", async () => {
      const runIds = ["run-1", "run-2", "run-3"];
      mockGetRunIdsForSet.mockResolvedValue({ runIds, reachedCap: false });

      mockDeleteRun
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("delete failed"))
        .mockResolvedValueOnce(undefined);

      const result = await archiveScenarioSetRuns("project-a", "set-a");

      expect(result.archived).toBe(2);
      expect(result.failed).toBe(1);
      expect(mockDeleteRun).toHaveBeenCalledTimes(3);
    });
  });

  describe("when reachedCap is true", () => {
    it("returns hasMore: true", async () => {
      mockGetRunIdsForSet.mockResolvedValue({ runIds: ["run-1"], reachedCap: true });

      const result = await archiveScenarioSetRuns("project-a", "set-big");

      expect(result.hasMore).toBe(true);
    });
  });

  describe("when reachedCap is false", () => {
    it("returns hasMore: false", async () => {
      mockGetRunIdsForSet.mockResolvedValue({ runIds: ["run-1"], reachedCap: false });

      const result = await archiveScenarioSetRuns("project-a", "set-small");

      expect(result.hasMore).toBe(false);
    });
  });

  describe("when 32 ids are dispatched with concurrency 8", () => {
    it("has at most 8 deleteRun calls in flight at once", async () => {
      const runIds = Array.from({ length: 32 }, (_, i) => `run-${i}`);
      mockGetRunIdsForSet.mockResolvedValue({ runIds, reachedCap: false });

      let maxInFlight = 0;
      let currentInFlight = 0;

      const resolvers: Array<() => void> = [];

      mockDeleteRun.mockImplementation(() => {
        currentInFlight++;
        if (currentInFlight > maxInFlight) maxInFlight = currentInFlight;

        return new Promise<void>((resolve) => {
          resolvers.push(() => {
            currentInFlight--;
            resolve();
          });
        });
      });

      // Start archiving (will block until resolvers are called)
      const archivePromise = archiveScenarioSetRuns("project-a", "set-32");

      // Yield a macrotask tick so pMapLimited has time to start and fill
      // the first concurrency window (8 slots) before we start draining.
      await new Promise<void>((r) => setTimeout(r, 0));

      // Drain resolvers in round-trip loops: release all currently pending,
      // yield, then repeat until everything is settled.
      while (resolvers.length > 0) {
        const batch = resolvers.splice(0, resolvers.length);
        for (const resolve of batch) resolve();
        await new Promise<void>((r) => setTimeout(r, 0));
      }

      await archivePromise;

      expect(maxInFlight).toBeLessThanOrEqual(8);
      expect(mockDeleteRun).toHaveBeenCalledTimes(32);
    });
  });

  describe("when getRunIdsForSet returns an empty list", () => {
    it("returns archived=0, failed=0, hasMore=false without calling deleteRun", async () => {
      mockGetRunIdsForSet.mockResolvedValue({ runIds: [], reachedCap: false });

      const result = await archiveScenarioSetRuns("project-a", "ghost-set");

      expect(result.archived).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.hasMore).toBe(false);
      expect(mockDeleteRun).not.toHaveBeenCalled();
    });
  });
});
