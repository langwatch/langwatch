/**
 * Unit tests for ScenarioCancellationService.
 *
 * The service uses a "try remove, then signal" strategy:
 * - removeQueuedJob succeeds → job was queued, write CANCELLED event
 * - removeQueuedJob fails, signalCancel succeeds → job was active, worker handles event
 * - Both fail → job is terminal or not found
 *
 * Batch cancellation reads run state from fold projections (getRunsForBatch).
 *
 * @see specs/features/suites/cancel-queued-running-jobs.feature
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ScenarioRunStatus } from "../scenario-event.enums";
import { ScenarioCancellationService } from "../cancellation";
import type { CancellationServiceDeps } from "../cancellation";

function createMockDeps(): {
  deps: CancellationServiceDeps;
  mockGetRunsForBatch: ReturnType<typeof vi.fn>;
  mockRemoveQueuedJob: ReturnType<typeof vi.fn>;
  mockSignalCancel: ReturnType<typeof vi.fn>;
  mockSaveScenarioEvent: ReturnType<typeof vi.fn>;
} {
  const mockGetRunsForBatch = vi.fn().mockResolvedValue([]);
  const mockRemoveQueuedJob = vi.fn().mockResolvedValue(false);
  const mockSignalCancel = vi.fn().mockResolvedValue(true);
  const mockSaveScenarioEvent = vi.fn().mockResolvedValue(undefined);

  const deps: CancellationServiceDeps = {
    getRunsForBatch: mockGetRunsForBatch,
    removeQueuedJob: mockRemoveQueuedJob,
    signalCancel: mockSignalCancel,
    saveScenarioEvent: mockSaveScenarioEvent,
  };

  return { deps, mockGetRunsForBatch, mockRemoveQueuedJob, mockSignalCancel, mockSaveScenarioEvent };
}

const defaultJobParams = {
  projectId: "proj1",
  scenarioSetId: "set1",
  batchRunId: "batch1",
  scenarioRunId: "run1",
  scenarioId: "sc1",
};

describe("ScenarioCancellationService", () => {
  describe("cancelJob()", () => {
    describe("when the job is queued (removeQueuedJob succeeds)", () => {
      let result: { cancelled: boolean };
      let mockSaveScenarioEvent: ReturnType<typeof vi.fn>;
      let mockSignalCancel: ReturnType<typeof vi.fn>;

      beforeEach(async () => {
        const { deps, mockRemoveQueuedJob, mockSaveScenarioEvent: saveFn, mockSignalCancel: signalFn } = createMockDeps();
        mockSaveScenarioEvent = saveFn;
        mockSignalCancel = signalFn;
        mockRemoveQueuedJob.mockResolvedValue(true);

        const service = new ScenarioCancellationService(deps);
        result = await service.cancelJob(defaultJobParams);
      });

      it("writes a CANCELLED event", () => {
        expect(mockSaveScenarioEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: "proj1",
            status: ScenarioRunStatus.CANCELLED,
          }),
        );
      });

      it("does not signal cancel (job was not active)", () => {
        expect(mockSignalCancel).not.toHaveBeenCalled();
      });

      it("returns cancelled with method removed", () => {
        expect(result).toEqual({ cancelled: true, method: "removed" });
      });
    });

    describe("when the job is active (removeQueuedJob fails, signalCancel succeeds)", () => {
      let result: { cancelled: boolean };
      let mockSignalCancel: ReturnType<typeof vi.fn>;
      let mockSaveScenarioEvent: ReturnType<typeof vi.fn>;

      beforeEach(async () => {
        const { deps, mockRemoveQueuedJob, mockSignalCancel: signalFn, mockSaveScenarioEvent: saveFn } = createMockDeps();
        mockSignalCancel = signalFn;
        mockSaveScenarioEvent = saveFn;
        mockRemoveQueuedJob.mockResolvedValue(false);
        mockSignalCancel.mockResolvedValue(true);

        const service = new ScenarioCancellationService(deps);
        result = await service.cancelJob(defaultJobParams);
      });

      it("publishes a cancellation signal", () => {
        expect(mockSignalCancel).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: "proj1",
            scenarioRunId: "run1",
            batchRunId: "batch1",
          }),
        );
      });

      it("does not write an event (worker handles it)", () => {
        expect(mockSaveScenarioEvent).not.toHaveBeenCalled();
      });

      it("returns cancelled with method signalled", () => {
        expect(result).toEqual({ cancelled: true, method: "signalled" });
      });
    });

    describe("when the job is active and Redis is unavailable", () => {
      let result: { cancelled: boolean };

      beforeEach(async () => {
        const { deps, mockRemoveQueuedJob, mockSignalCancel } = createMockDeps();
        mockRemoveQueuedJob.mockResolvedValue(false);
        mockSignalCancel.mockResolvedValue(false);

        const service = new ScenarioCancellationService(deps);
        result = await service.cancelJob(defaultJobParams);
      });

      it("returns cancelled: false", () => {
        expect(result).toEqual({ cancelled: false });
      });
    });

    describe("when neither remove nor signal succeeds (terminal or not found)", () => {
      let result: { cancelled: boolean };

      beforeEach(async () => {
        const { deps, mockRemoveQueuedJob, mockSignalCancel } = createMockDeps();
        mockRemoveQueuedJob.mockResolvedValue(false);
        mockSignalCancel.mockResolvedValue(false);

        const service = new ScenarioCancellationService(deps);
        result = await service.cancelJob(defaultJobParams);
      });

      it("returns cancelled: false", () => {
        expect(result).toEqual({ cancelled: false });
      });
    });
  });

  describe("cancelBatchRun()", () => {
    describe("when a batch has runs in mixed states", () => {
      let result: { cancelledCount: number; skippedCount: number };
      let mockRemoveQueuedJob: ReturnType<typeof vi.fn>;
      let mockSignalCancel: ReturnType<typeof vi.fn>;

      beforeEach(async () => {
        const {
          deps,
          mockGetRunsForBatch,
          mockRemoveQueuedJob: removeFn,
          mockSignalCancel: signalFn,
        } = createMockDeps();
        mockRemoveQueuedJob = removeFn;
        mockSignalCancel = signalFn;

        mockGetRunsForBatch.mockResolvedValue([
          { scenarioRunId: "run1", scenarioId: "sc1", batchRunId: "batch1", status: ScenarioRunStatus.PENDING },
          { scenarioRunId: "run2", scenarioId: "sc2", batchRunId: "batch1", status: ScenarioRunStatus.IN_PROGRESS },
          { scenarioRunId: "run3", scenarioId: "sc3", batchRunId: "batch1", status: ScenarioRunStatus.SUCCESS },
        ]);

        // run1 is queued (remove succeeds), run2 is active (remove fails, signal succeeds)
        mockRemoveQueuedJob.mockImplementation(async ({ scenarioRunId }: { scenarioRunId: string }) => {
          return scenarioRunId === "run1";
        });

        const service = new ScenarioCancellationService(deps);
        result = await service.cancelBatchRun({
          projectId: "proj1",
          scenarioSetId: "set1",
          batchRunId: "batch1",
        });
      });

      it("removes the queued job", () => {
        expect(mockRemoveQueuedJob).toHaveBeenCalledWith(
          expect.objectContaining({ scenarioRunId: "run1" }),
        );
      });

      it("signals cancel for the active run", () => {
        expect(mockSignalCancel).toHaveBeenCalledWith(
          expect.objectContaining({ scenarioRunId: "run2" }),
        );
      });

      it("reports the number of cancelled runs", () => {
        expect(result.cancelledCount).toBe(2);
      });

      it("reports the number of skipped runs", () => {
        expect(result.skippedCount).toBe(1);
      });
    });

    describe("when all runs are already completed", () => {
      let result: { cancelledCount: number; skippedCount: number };

      beforeEach(async () => {
        const { deps, mockGetRunsForBatch } = createMockDeps();
        mockGetRunsForBatch.mockResolvedValue([
          { scenarioRunId: "run1", scenarioId: "sc1", batchRunId: "batch1", status: ScenarioRunStatus.SUCCESS },
        ]);

        const service = new ScenarioCancellationService(deps);
        result = await service.cancelBatchRun({
          projectId: "proj1",
          scenarioSetId: "set1",
          batchRunId: "batch1",
        });
      });

      it("returns zero cancelled count", () => {
        expect(result.cancelledCount).toBe(0);
      });

      it("reports the completed runs as skipped", () => {
        expect(result.skippedCount).toBe(1);
      });
    });

    describe("when no runs exist for the batch", () => {
      let result: { cancelledCount: number; skippedCount: number };

      beforeEach(async () => {
        const { deps, mockGetRunsForBatch } = createMockDeps();
        mockGetRunsForBatch.mockResolvedValue([]);

        const service = new ScenarioCancellationService(deps);
        result = await service.cancelBatchRun({
          projectId: "proj1",
          scenarioSetId: "set1",
          batchRunId: "batch1",
        });
      });

      it("returns zero counts", () => {
        expect(result).toEqual({ cancelledCount: 0, skippedCount: 0 });
      });
    });

    describe("when cancelling with concurrency", () => {
      it("processes cancellable runs in parallel chunks", async () => {
        const { deps, mockGetRunsForBatch, mockRemoveQueuedJob } = createMockDeps();
        let concurrentCount = 0;
        let maxConcurrent = 0;

        mockRemoveQueuedJob.mockImplementation(async () => {
          concurrentCount++;
          maxConcurrent = Math.max(maxConcurrent, concurrentCount);
          await new Promise((r) => setTimeout(r, 10));
          concurrentCount--;
          return true;
        });

        mockGetRunsForBatch.mockResolvedValue(
          Array.from({ length: 25 }, (_, i) => ({
            scenarioRunId: `run${i}`,
            scenarioId: `sc${i}`,
            batchRunId: "batch1",
            status: ScenarioRunStatus.PENDING,
          })),
        );

        const service = new ScenarioCancellationService(deps);
        const result = await service.cancelBatchRun({
          projectId: "proj1",
          scenarioSetId: "set1",
          batchRunId: "batch1",
        });

        expect(result.cancelledCount).toBe(25);
        expect(maxConcurrent).toBeGreaterThan(1);
        expect(maxConcurrent).toBeLessThanOrEqual(10);
      });
    });
  });
});
