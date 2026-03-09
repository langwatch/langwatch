/**
 * Integration tests for ScenarioCancellationService.
 *
 * Tests the cancellation orchestration logic with mocked external boundaries:
 * - Queue operations (remove, move to failed, getJobs)
 * - Event persistence (save scenario event)
 * - Simulation service (read batch run data)
 *
 * @see specs/features/suites/cancel-queued-running-jobs.feature
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ScenarioRunStatus } from "../scenario-event.enums";
import {
  CrossProjectAuthorizationError,
  ScenarioCancellationService,
} from "../cancellation";
import type { CancellationServiceDeps } from "../cancellation";

function createMockDeps() {
  const mockGetJob = vi.fn();
  const mockGetJobs = vi.fn().mockResolvedValue([]);
  const mockSaveScenarioEvent = vi.fn().mockResolvedValue(undefined);
  const mockGetRunDataForBatchRun = vi.fn();

  const deps: CancellationServiceDeps = {
    queue: { getJob: mockGetJob, getJobs: mockGetJobs },
    simulationService: {
      saveScenarioEvent: mockSaveScenarioEvent,
      getRunDataForBatchRun: mockGetRunDataForBatchRun,
    },
  };

  return { deps, mockGetJob, mockGetJobs, mockSaveScenarioEvent, mockGetRunDataForBatchRun };
}

function createMockBullmqJob({
  projectId = "proj1",
  state = "waiting",
  batchRunId = "batch1",
}: {
  projectId?: string;
  state?: string;
  batchRunId?: string;
} = {}) {
  return {
    id: `job-${Math.random()}`,
    data: { projectId, batchRunId },
    getState: vi.fn().mockResolvedValue(state),
    remove: vi.fn().mockResolvedValue(undefined),
    moveToFailed: vi.fn().mockResolvedValue(undefined),
  };
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
      let mockJob: ReturnType<typeof createMockBullmqJob>;
      let mockSaveScenarioEvent: ReturnType<typeof vi.fn>;

      beforeEach(async () => {
        const { deps, mockGetJob, mockSaveScenarioEvent: saveFn } = createMockDeps();
        mockSaveScenarioEvent = saveFn;
        mockJob = createMockBullmqJob({ state: "waiting" });
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
      let mockJob: ReturnType<typeof createMockBullmqJob>;
      let mockSaveScenarioEvent: ReturnType<typeof vi.fn>;

      beforeEach(async () => {
        const { deps, mockGetJob, mockSaveScenarioEvent: saveFn } = createMockDeps();
        mockSaveScenarioEvent = saveFn;
        mockJob = createMockBullmqJob({ state: "active" });
        mockGetJob.mockResolvedValue(mockJob);

        const service = new ScenarioCancellationService(deps);
        result = await service.cancelJob(defaultJobParams);
      });

      it("marks the job as failed in the queue", () => {
        expect(mockJob.moveToFailed).toHaveBeenCalled();
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
        mockGetJob.mockResolvedValue(
          createMockBullmqJob({ state: "completed" }),
        );

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
        mockGetJob.mockResolvedValue(
          createMockBullmqJob({ state: "failed" }),
        );

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

    describe("when the job belongs to a different project", () => {
      it("throws CrossProjectAuthorizationError", async () => {
        const { deps, mockGetJob } = createMockDeps();
        mockGetJob.mockResolvedValue(
          createMockBullmqJob({ projectId: "other-project", state: "waiting" }),
        );

        const service = new ScenarioCancellationService(deps);
        await expect(service.cancelJob(defaultJobParams)).rejects.toThrow(
          CrossProjectAuthorizationError,
        );
      });
    });

    describe("when a race condition occurs during BullMQ removal", () => {
      let result: { cancelled: boolean };
      let mockSaveScenarioEvent: ReturnType<typeof vi.fn>;

      beforeEach(async () => {
        const { deps, mockGetJob, mockSaveScenarioEvent: saveFn } = createMockDeps();
        mockSaveScenarioEvent = saveFn;
        const mockJob = createMockBullmqJob({ state: "waiting" });
        mockJob.remove.mockRejectedValue(new Error("Missing lock for job"));
        mockGetJob.mockResolvedValue(mockJob);

        const service = new ScenarioCancellationService(deps);
        result = await service.cancelJob(defaultJobParams);
      });

      it("still persists the cancellation event", () => {
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

      beforeEach(async () => {
        const { deps, mockGetJobs, mockSaveScenarioEvent: saveFn } = createMockDeps();
        mockSaveScenarioEvent = saveFn;
        mockGetJobs.mockResolvedValue([]);
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
        const { deps, mockGetJobs, mockSaveScenarioEvent: saveFn } = createMockDeps();
        mockSaveScenarioEvent = saveFn;
        mockGetJobs.mockResolvedValue([]);
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

    describe("when batch has BullMQ jobs to cancel", () => {
      let waitingJob: ReturnType<typeof createMockBullmqJob>;
      let activeJob: ReturnType<typeof createMockBullmqJob>;
      let completedJob: ReturnType<typeof createMockBullmqJob>;

      beforeEach(async () => {
        const { deps, mockGetJobs } = createMockDeps();

        waitingJob = createMockBullmqJob({ state: "waiting", batchRunId: "batch1" });
        activeJob = createMockBullmqJob({ state: "active", batchRunId: "batch1" });
        completedJob = createMockBullmqJob({ state: "completed", batchRunId: "batch1" });

        // getJobs is called twice: once for "waiting", once for "active"
        mockGetJobs
          .mockResolvedValueOnce([waitingJob])      // waiting
          .mockResolvedValueOnce([activeJob]);       // active

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
        await service.cancelBatchRun({
          projectId: "proj1",
          scenarioSetId: "set1",
          batchRunId: "batch1",
        });
      });

      it("removes queued jobs from BullMQ", () => {
        expect(waitingJob.remove).toHaveBeenCalled();
      });

      it("moves active jobs to failed in BullMQ", () => {
        expect(activeJob.moveToFailed).toHaveBeenCalled();
      });
    });

    describe("when batch BullMQ jobs belong to a different batch", () => {
      it("does not touch BullMQ jobs from other batches", async () => {
        const { deps, mockGetJobs } = createMockDeps();

        const otherBatchJob = createMockBullmqJob({ state: "waiting", batchRunId: "other-batch" });
        mockGetJobs
          .mockResolvedValueOnce([otherBatchJob])   // waiting
          .mockResolvedValueOnce([]);                // active

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

        expect(otherBatchJob.remove).not.toHaveBeenCalled();
      });
    });

    describe("when a BullMQ race condition occurs during batch cancel", () => {
      it("continues cancelling other jobs and persists events", async () => {
        const { deps, mockGetJobs, mockSaveScenarioEvent } = createMockDeps();

        const failingJob = createMockBullmqJob({ state: "waiting", batchRunId: "batch1" });
        failingJob.remove.mockRejectedValue(new Error("Missing lock"));

        const okJob = createMockBullmqJob({ state: "waiting", batchRunId: "batch1" });

        mockGetJobs
          .mockResolvedValueOnce([failingJob, okJob])  // waiting
          .mockResolvedValueOnce([]);                   // active

        deps.simulationService.getRunDataForBatchRun = vi.fn().mockResolvedValue({
          changed: true,
          lastUpdatedAt: 0,
          runs: [
            { scenarioRunId: "run1", scenarioId: "sc1", batchRunId: "batch1", status: ScenarioRunStatus.PENDING },
            { scenarioRunId: "run2", scenarioId: "sc2", batchRunId: "batch1", status: ScenarioRunStatus.PENDING },
          ],
        });

        const service = new ScenarioCancellationService(deps);
        const result = await service.cancelBatchRun({
          projectId: "proj1",
          scenarioSetId: "set1",
          batchRunId: "batch1",
        });

        // Both cancellation events persisted despite BullMQ failure on one
        expect(mockSaveScenarioEvent).toHaveBeenCalledTimes(2);
        expect(result.cancelledCount).toBe(2);
        // The non-failing job was still removed
        expect(okJob.remove).toHaveBeenCalled();
      });
    });

    describe("when cancelling with concurrency", () => {
      it("processes cancellable runs in parallel chunks", async () => {
        const { deps, mockGetJobs } = createMockDeps();
        let concurrentCount = 0;
        let maxConcurrent = 0;

        mockGetJobs.mockResolvedValue([]);

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
