/**
 * Unit tests for ScenarioCancellationService.
 *
 * Tests the cancellation orchestration logic with mocked external boundaries:
 * - Queue operations (remove, move to failed)
 * - Event persistence (save scenario event)
 * - Simulation service (read batch run data)
 *
 * @see specs/features/suites/cancel-queued-running-jobs.feature
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ScenarioRunStatus } from "../scenario-event.enums";
import { ScenarioCancellationService } from "../cancellation";
import type { CancellationServiceDeps } from "../cancellation";

function createMockDeps() {
  const mockGetJob = vi.fn();
  const mockSaveScenarioEvent = vi.fn().mockResolvedValue(undefined);
  const mockGetRunDataForBatchRun = vi.fn();
  const mockGetScenarioRunData = vi.fn().mockResolvedValue(null);
  const mockPublishCancellation = vi.fn().mockResolvedValue(undefined);

  const deps: CancellationServiceDeps = {
    queue: { getJob: mockGetJob },
    simulationService: {
      saveScenarioEvent: mockSaveScenarioEvent,
      getRunDataForBatchRun: mockGetRunDataForBatchRun,
      getScenarioRunData: mockGetScenarioRunData,
    },
    publishCancellation: mockPublishCancellation,
  };

  return { deps, mockGetJob, mockSaveScenarioEvent, mockGetRunDataForBatchRun, mockGetScenarioRunData, mockPublishCancellation };
}

const defaultJobParams = {
  projectId: "proj1",
  jobId: "job-1",
  scenarioSetId: "set1",
  batchRunId: "batch1",
  scenarioRunId: "run1",
  scenarioId: "sc1",
};

describe("ScenarioCancellationService", () => {
  describe("cancelJob()", () => {
    describe("when the job is queued", () => {
      let result: { cancelled: boolean };
      let mockJob: { getState: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
      let mockSaveScenarioEvent: ReturnType<typeof vi.fn>;

      beforeEach(async () => {
        const { deps, mockGetJob, mockSaveScenarioEvent: saveFn } = createMockDeps();
        mockSaveScenarioEvent = saveFn;
        mockJob = {
          getState: vi.fn().mockResolvedValue("waiting"),
          remove: vi.fn().mockResolvedValue(undefined),
        };
        mockGetJob.mockResolvedValue(mockJob);

        const service = new ScenarioCancellationService(deps);
        result = await service.cancelJob(defaultJobParams);
      });

      it("removes the job from the queue", () => {
        expect(mockJob.remove).toHaveBeenCalled();
      });

      it("persists a cancellation event", () => {
        expect(mockSaveScenarioEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: "proj1",
            status: ScenarioRunStatus.CANCELLED,
          }),
        );
      });

      it("returns cancelled: true", () => {
        expect(result).toEqual({ cancelled: true });
      });
    });

    describe("when the job is actively running", () => {
      let result: { cancelled: boolean };
      let mockPublishCancellation: ReturnType<typeof vi.fn>;
      let mockSaveScenarioEvent: ReturnType<typeof vi.fn>;

      beforeEach(async () => {
        const { deps, mockGetJob, mockSaveScenarioEvent: saveFn, mockPublishCancellation: publishFn } = createMockDeps();
        mockSaveScenarioEvent = saveFn;
        mockPublishCancellation = publishFn;
        mockGetJob.mockResolvedValue({
          getState: vi.fn().mockResolvedValue("active"),
        });

        const service = new ScenarioCancellationService(deps);
        result = await service.cancelJob(defaultJobParams);
      });

      it("publishes a cancellation signal via Redis pub/sub", () => {
        expect(mockPublishCancellation).toHaveBeenCalledWith(
          expect.objectContaining({ jobId: "job-1" }),
        );
      });

      it("persists a cancellation event", () => {
        expect(mockSaveScenarioEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: "proj1",
            status: ScenarioRunStatus.CANCELLED,
          }),
        );
      });

      it("returns cancelled: true", () => {
        expect(result).toEqual({ cancelled: true });
      });
    });

    describe("when the job is already completed", () => {
      let result: { cancelled: boolean };
      let mockSaveScenarioEvent: ReturnType<typeof vi.fn>;

      beforeEach(async () => {
        const { deps, mockGetJob, mockSaveScenarioEvent: saveFn } = createMockDeps();
        mockSaveScenarioEvent = saveFn;
        mockGetJob.mockResolvedValue({
          getState: vi.fn().mockResolvedValue("completed"),
        });

        const service = new ScenarioCancellationService(deps);
        result = await service.cancelJob(defaultJobParams);
      });

      it("does not persist a cancellation event", () => {
        expect(mockSaveScenarioEvent).not.toHaveBeenCalled();
      });

      it("returns cancelled: false", () => {
        expect(result).toEqual({ cancelled: false });
      });
    });

    describe("when the job is already failed", () => {
      let result: { cancelled: boolean };
      let mockSaveScenarioEvent: ReturnType<typeof vi.fn>;

      beforeEach(async () => {
        const { deps, mockGetJob, mockSaveScenarioEvent: saveFn } = createMockDeps();
        mockSaveScenarioEvent = saveFn;
        mockGetJob.mockResolvedValue({
          getState: vi.fn().mockResolvedValue("failed"),
        });

        const service = new ScenarioCancellationService(deps);
        result = await service.cancelJob(defaultJobParams);
      });

      it("does not persist a cancellation event", () => {
        expect(mockSaveScenarioEvent).not.toHaveBeenCalled();
      });

      it("returns cancelled: false", () => {
        expect(result).toEqual({ cancelled: false });
      });
    });

    describe("when the queue job does not exist", () => {
      let result: { cancelled: boolean };
      let mockSaveScenarioEvent: ReturnType<typeof vi.fn>;

      beforeEach(async () => {
        const { deps, mockGetJob, mockSaveScenarioEvent: saveFn } = createMockDeps();
        mockSaveScenarioEvent = saveFn;
        mockGetJob.mockResolvedValue(undefined);

        const service = new ScenarioCancellationService(deps);
        result = await service.cancelJob(defaultJobParams);
      });

      it("persists a cancellation event", () => {
        expect(mockSaveScenarioEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: "proj1",
            status: ScenarioRunStatus.CANCELLED,
          }),
        );
      });

      it("returns cancelled: true", () => {
        expect(result).toEqual({ cancelled: true });
      });
    });
  });

  describe("cancelBatchRun()", () => {
    describe("when a batch has jobs in mixed states", () => {
      let result: { cancelledCount: number; skippedCount: number };
      let mockSaveScenarioEvent: ReturnType<typeof vi.fn>;
      let mockGetJob: ReturnType<typeof vi.fn>;
      let mockPublishCancellation: ReturnType<typeof vi.fn>;
      let mockRemoveRun1: ReturnType<typeof vi.fn>;

      beforeEach(async () => {
        const { deps, mockSaveScenarioEvent: saveFn, mockGetJob: getJobFn, mockPublishCancellation: publishFn } = createMockDeps();
        mockSaveScenarioEvent = saveFn;
        mockGetJob = getJobFn;
        mockPublishCancellation = publishFn;

        mockRemoveRun1 = vi.fn().mockResolvedValue(undefined);

        // run1 (PENDING) => queued BullMQ job
        // run2 (IN_PROGRESS) => active BullMQ job
        // run3 (SUCCESS) => skipped, cancelBatchRun filters it out before calling cancelJob
        mockGetJob.mockImplementation(async (jobId: string) => {
          if (jobId === "run1") return { getState: vi.fn().mockResolvedValue("waiting"), remove: mockRemoveRun1 };
          if (jobId === "run2") return { getState: vi.fn().mockResolvedValue("active") };
          return undefined;
        });

        deps.simulationService.getRunDataForBatchRun = vi.fn().mockResolvedValue({
          changed: true,
          lastUpdatedAt: 0,
          runs: [
            { scenarioRunId: "run1", scenarioId: "sc1", batchRunId: "batch1", status: ScenarioRunStatus.PENDING },
            { scenarioRunId: "run2", scenarioId: "sc2", batchRunId: "batch1", status: ScenarioRunStatus.IN_PROGRESS },
            { scenarioRunId: "run3", scenarioId: "sc3", batchRunId: "batch1", status: ScenarioRunStatus.SUCCESS },
          ],
        });

        const service = new ScenarioCancellationService(deps);
        result = await service.cancelBatchRun({
          projectId: "proj1",
          scenarioSetId: "set1",
          batchRunId: "batch1",
        });
      });

      it("removes the queued BullMQ job for the pending run", () => {
        expect(mockRemoveRun1).toHaveBeenCalled();
      });

      it("publishes a cancellation signal for the active run", () => {
        expect(mockPublishCancellation).toHaveBeenCalledWith(
          expect.objectContaining({ jobId: "run2" }),
        );
      });

      it("persists cancellation events for pending and in-progress runs only", () => {
        expect(mockSaveScenarioEvent).toHaveBeenCalledTimes(2);
      });

      it("reports the number of cancelled runs", () => {
        expect(result.cancelledCount).toBe(2);
      });

      it("reports the number of skipped runs", () => {
        expect(result.skippedCount).toBe(1);
      });
    });

    describe("when all jobs are already completed", () => {
      let result: { cancelledCount: number; skippedCount: number };
      let mockSaveScenarioEvent: ReturnType<typeof vi.fn>;

      beforeEach(async () => {
        const { deps, mockSaveScenarioEvent: saveFn } = createMockDeps();
        mockSaveScenarioEvent = saveFn;
        deps.simulationService.getRunDataForBatchRun = vi.fn().mockResolvedValue({
          changed: true,
          lastUpdatedAt: 0,
          runs: [
            { scenarioRunId: "run1", scenarioId: "sc1", batchRunId: "batch1", status: ScenarioRunStatus.SUCCESS },
          ],
        });

        const service = new ScenarioCancellationService(deps);
        result = await service.cancelBatchRun({
          projectId: "proj1",
          scenarioSetId: "set1",
          batchRunId: "batch1",
        });
      });

      it("does not persist any cancellation events", () => {
        expect(mockSaveScenarioEvent).not.toHaveBeenCalled();
      });

      it("returns zero cancelled count", () => {
        expect(result.cancelledCount).toBe(0);
      });

      it("reports the completed runs as skipped", () => {
        expect(result.skippedCount).toBe(1);
      });
    });

    describe("when the BullMQ job does not exist for a run", () => {
      let mockSaveScenarioEvent: ReturnType<typeof vi.fn>;
      let mockGetJob: ReturnType<typeof vi.fn>;

      beforeEach(async () => {
        const { deps, mockSaveScenarioEvent: saveFn, mockGetJob: getJobFn } = createMockDeps();
        mockSaveScenarioEvent = saveFn;
        mockGetJob = getJobFn;
        mockGetJob.mockResolvedValue(undefined);

        deps.simulationService.getRunDataForBatchRun = vi.fn().mockResolvedValue({
          changed: true,
          lastUpdatedAt: 0,
          runs: [
            { scenarioRunId: "run1", scenarioId: "sc1", batchRunId: "batch1", status: ScenarioRunStatus.PENDING },
          ],
        });

        const service = new ScenarioCancellationService(deps);
        await service.cancelBatchRun({
          projectId: "proj1",
          scenarioSetId: "set1",
          batchRunId: "batch1",
        });
      });

      it("still persists the cancellation event", () => {
        expect(mockSaveScenarioEvent).toHaveBeenCalledWith(
          expect.objectContaining({ status: ScenarioRunStatus.CANCELLED }),
        );
      });
    });

    describe("when cancelling with concurrency", () => {
      it("processes cancellable runs in parallel chunks", async () => {
        const { deps, mockGetJob } = createMockDeps();
        const callOrder: number[] = [];
        let concurrentCount = 0;
        let maxConcurrent = 0;

        mockGetJob.mockResolvedValue(undefined);

        deps.simulationService.getRunDataForBatchRun = vi.fn().mockResolvedValue({
          changed: true,
          lastUpdatedAt: 0,
          runs: Array.from({ length: 25 }, (_, i) => ({
            scenarioRunId: `run${i}`,
            scenarioId: `sc${i}`,
            batchRunId: "batch1",
            status: ScenarioRunStatus.PENDING,
          })),
        });

        deps.simulationService.saveScenarioEvent = vi.fn().mockImplementation(async () => {
          concurrentCount++;
          maxConcurrent = Math.max(maxConcurrent, concurrentCount);
          await new Promise((r) => setTimeout(r, 10));
          callOrder.push(concurrentCount);
          concurrentCount--;
        });

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
