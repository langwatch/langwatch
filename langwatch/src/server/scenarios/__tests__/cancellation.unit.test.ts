/**
 * Unit tests for ScenarioCancellationService.
 *
 * The service uses event-sourcing for cancellation:
 * - Dispatches cancel_requested event (always)
 * - For queued jobs: also dispatches finished(CANCELLED)
 * - For active jobs: reactor broadcasts to workers, worker kills child
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
  mockDispatchCancelRequested: ReturnType<typeof vi.fn>;
  mockDispatchFinishRun: ReturnType<typeof vi.fn>;
} {
  const mockGetRunsForBatch = vi.fn().mockResolvedValue([]);
  const mockDispatchCancelRequested = vi.fn().mockResolvedValue(undefined);
  const mockDispatchFinishRun = vi.fn().mockResolvedValue(undefined);

  const deps: CancellationServiceDeps = {
    getRunsForBatch: mockGetRunsForBatch,
    dispatchCancelRequested: mockDispatchCancelRequested,
    dispatchFinishRun: mockDispatchFinishRun,
  };

  return { deps, mockGetRunsForBatch, mockDispatchCancelRequested, mockDispatchFinishRun };
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
    function stubRunStatus(mock: ReturnType<typeof vi.fn>, status: ScenarioRunStatus) {
      mock.mockResolvedValue([
        { scenarioRunId: "run1", scenarioId: "sc1", batchRunId: "batch1", status },
      ]);
    }

    describe("when the run is already terminal (e.g. SUCCESS)", () => {
      let result: { cancelled: boolean };
      let mockDispatchCancelRequested: ReturnType<typeof vi.fn>;

      beforeEach(async () => {
        const { deps, mockGetRunsForBatch, mockDispatchCancelRequested: cancelFn } = createMockDeps();
        mockDispatchCancelRequested = cancelFn;
        stubRunStatus(mockGetRunsForBatch, ScenarioRunStatus.SUCCESS);

        const service = new ScenarioCancellationService(deps);
        result = await service.cancelJob(defaultJobParams);
      });

      it("returns cancelled: false", () => {
        expect(result).toEqual({ cancelled: false });
      });

      it("does not dispatch cancel event", () => {
        expect(mockDispatchCancelRequested).not.toHaveBeenCalled();
      });
    });

    describe("when the job is queued", () => {
      let result: { cancelled: boolean };
      let mockDispatchCancelRequested: ReturnType<typeof vi.fn>;
      let mockDispatchFinishRun: ReturnType<typeof vi.fn>;

      beforeEach(async () => {
        const { deps, mockGetRunsForBatch, mockDispatchCancelRequested: cancelFn, mockDispatchFinishRun: finishFn } = createMockDeps();
        mockDispatchCancelRequested = cancelFn;
        mockDispatchFinishRun = finishFn;
        stubRunStatus(mockGetRunsForBatch, ScenarioRunStatus.QUEUED);

        const service = new ScenarioCancellationService(deps);
        result = await service.cancelJob(defaultJobParams);
      });

      it("dispatches cancel_requested event", () => {
        expect(mockDispatchCancelRequested).toHaveBeenCalledWith(
          expect.objectContaining({
            tenantId: "proj1",
            scenarioRunId: "run1",
          }),
        );
      });

      it("also dispatches finished(CANCELLED) since no worker will pick it up", () => {
        expect(mockDispatchFinishRun).toHaveBeenCalledWith(
          expect.objectContaining({
            tenantId: "proj1",
            scenarioRunId: "run1",
            status: ScenarioRunStatus.CANCELLED,
          }),
        );
      });

      it("returns cancelled: true", () => {
        expect(result).toEqual({ cancelled: true });
      });
    });

    describe("when the job is active (IN_PROGRESS)", () => {
      let result: { cancelled: boolean };
      let mockDispatchCancelRequested: ReturnType<typeof vi.fn>;
      let mockDispatchFinishRun: ReturnType<typeof vi.fn>;

      beforeEach(async () => {
        const { deps, mockGetRunsForBatch, mockDispatchCancelRequested: cancelFn, mockDispatchFinishRun: finishFn } = createMockDeps();
        mockDispatchCancelRequested = cancelFn;
        mockDispatchFinishRun = finishFn;
        stubRunStatus(mockGetRunsForBatch, ScenarioRunStatus.IN_PROGRESS);

        const service = new ScenarioCancellationService(deps);
        result = await service.cancelJob(defaultJobParams);
      });

      it("dispatches cancel_requested event", () => {
        expect(mockDispatchCancelRequested).toHaveBeenCalledWith(
          expect.objectContaining({
            tenantId: "proj1",
            scenarioRunId: "run1",
          }),
        );
      });

      it("does not dispatch finished (worker handles it after killing child)", () => {
        expect(mockDispatchFinishRun).not.toHaveBeenCalled();
      });

      it("returns cancelled: true", () => {
        expect(result).toEqual({ cancelled: true });
      });
    });

    describe("when run is not found in projection", () => {
      let result: { cancelled: boolean };
      let mockDispatchCancelRequested: ReturnType<typeof vi.fn>;

      beforeEach(async () => {
        const { deps, mockGetRunsForBatch, mockDispatchCancelRequested: cancelFn } = createMockDeps();
        mockDispatchCancelRequested = cancelFn;
        mockGetRunsForBatch.mockResolvedValue([]);

        const service = new ScenarioCancellationService(deps);
        result = await service.cancelJob(defaultJobParams);
      });

      it("still dispatches cancel_requested event (defensive)", () => {
        expect(mockDispatchCancelRequested).toHaveBeenCalled();
      });

      it("returns cancelled: true", () => {
        expect(result).toEqual({ cancelled: true });
      });
    });
  });

  describe("cancelBatchRun()", () => {
    describe("when a batch has runs in mixed states", () => {
      let result: { cancelledCount: number; skippedCount: number };
      let mockDispatchCancelRequested: ReturnType<typeof vi.fn>;

      beforeEach(async () => {
        const { deps, mockGetRunsForBatch, mockDispatchCancelRequested: cancelFn } = createMockDeps();
        mockDispatchCancelRequested = cancelFn;

        mockGetRunsForBatch.mockResolvedValue([
          { scenarioRunId: "run1", scenarioId: "sc1", batchRunId: "batch1", status: ScenarioRunStatus.PENDING },
          { scenarioRunId: "run2", scenarioId: "sc2", batchRunId: "batch1", status: ScenarioRunStatus.IN_PROGRESS },
          { scenarioRunId: "run3", scenarioId: "sc3", batchRunId: "batch1", status: ScenarioRunStatus.SUCCESS },
        ]);

        const service = new ScenarioCancellationService(deps);
        result = await service.cancelBatchRun({
          projectId: "proj1",
          scenarioSetId: "set1",
          batchRunId: "batch1",
        });
      });

      it("dispatches cancel events for cancellable runs", () => {
        expect(mockDispatchCancelRequested).toHaveBeenCalledTimes(2);
      });

      it("reports the correct cancelled count", () => {
        expect(result.cancelledCount).toBe(2);
      });

      it("reports the correct skipped count", () => {
        expect(result.skippedCount).toBe(1);
      });
    });

    describe("when all runs are completed", () => {
      it("returns zero cancelled count", async () => {
        const { deps, mockGetRunsForBatch } = createMockDeps();
        mockGetRunsForBatch.mockResolvedValue([
          { scenarioRunId: "run1", scenarioId: "sc1", batchRunId: "batch1", status: ScenarioRunStatus.SUCCESS },
        ]);

        const service = new ScenarioCancellationService(deps);
        const result = await service.cancelBatchRun({
          projectId: "proj1",
          scenarioSetId: "set1",
          batchRunId: "batch1",
        });

        expect(result).toEqual({ cancelledCount: 0, skippedCount: 1 });
      });
    });

    describe("when no runs exist", () => {
      it("returns zero counts", async () => {
        const { deps, mockGetRunsForBatch } = createMockDeps();
        mockGetRunsForBatch.mockResolvedValue([]);

        const service = new ScenarioCancellationService(deps);
        const result = await service.cancelBatchRun({
          projectId: "proj1",
          scenarioSetId: "set1",
          batchRunId: "batch1",
        });

        expect(result).toEqual({ cancelledCount: 0, skippedCount: 0 });
      });
    });
  });
});
