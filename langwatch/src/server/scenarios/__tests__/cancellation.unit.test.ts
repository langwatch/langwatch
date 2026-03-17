/**
 * Unit tests for ScenarioCancellationService.
 *
 * Cancellation is BullMQ-only: queued jobs are removed, active jobs get a
 * cancel signal via pub/sub, terminal/missing jobs are no-ops.
 *
 * @see specs/features/suites/cancel-queued-running-jobs.feature
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ScenarioRunStatus } from "../scenario-event.enums";
import { ScenarioCancellationService } from "../cancellation";
import type { CancellationServiceDeps } from "../cancellation";

function createMockDeps() {
  const mockGetJob = vi.fn();
  const mockPublishCancellation = vi.fn().mockResolvedValue(true);
  const mockGetQueuedJobs = vi.fn().mockResolvedValue([]);
  const mockSaveScenarioEvent = vi.fn().mockResolvedValue(undefined);

  const mockGetJobs = vi.fn().mockResolvedValue([]);

  const deps: CancellationServiceDeps = {
    queue: { getJob: mockGetJob, getJobs: mockGetJobs },
    publishCancellation: mockPublishCancellation,
    getQueuedJobs: mockGetQueuedJobs,
    saveScenarioEvent: mockSaveScenarioEvent,
  };

  return { deps, mockGetJob, mockPublishCancellation, mockGetQueuedJobs, mockSaveScenarioEvent };
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

      it("writes a CANCELLED event to ES", () => {
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
        const { deps, mockGetJob, mockPublishCancellation: publishFn, mockSaveScenarioEvent: saveFn } = createMockDeps();
        mockPublishCancellation = publishFn;
        mockSaveScenarioEvent = saveFn;
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

      it("does not write an event (worker handles it)", () => {
        expect(mockSaveScenarioEvent).not.toHaveBeenCalled();
      });

      it("returns cancelled: true", () => {
        expect(result).toEqual({ cancelled: true });
      });
    });

    describe("when the job is actively running and Redis is unavailable", () => {
      let result: { cancelled: boolean };

      beforeEach(async () => {
        const { deps, mockGetJob } = createMockDeps();
        mockGetJob.mockResolvedValue({
          getState: vi.fn().mockResolvedValue("active"),
        });
        const depsWithNoRedis: typeof deps = {
          ...deps,
          publishCancellation: vi.fn().mockResolvedValue(false),
        };

        const service = new ScenarioCancellationService(depsWithNoRedis);
        result = await service.cancelJob(defaultJobParams);
      });

      it("returns cancelled: false", () => {
        expect(result).toEqual({ cancelled: false });
      });
    });

    describe("when the BullMQ job is completed", () => {
      let result: { cancelled: boolean };

      beforeEach(async () => {
        const { deps, mockGetJob } = createMockDeps();
        mockGetJob.mockResolvedValue({
          getState: vi.fn().mockResolvedValue("completed"),
        });

        const service = new ScenarioCancellationService(deps);
        result = await service.cancelJob(defaultJobParams);
      });

      it("returns cancelled: false", () => {
        expect(result).toEqual({ cancelled: false });
      });
    });

    describe("when the BullMQ job is failed", () => {
      let result: { cancelled: boolean };

      beforeEach(async () => {
        const { deps, mockGetJob } = createMockDeps();
        mockGetJob.mockResolvedValue({
          getState: vi.fn().mockResolvedValue("failed"),
        });

        const service = new ScenarioCancellationService(deps);
        result = await service.cancelJob(defaultJobParams);
      });

      it("returns cancelled: false", () => {
        expect(result).toEqual({ cancelled: false });
      });
    });

    describe("when the queue job does not exist", () => {
      let result: { cancelled: boolean };

      beforeEach(async () => {
        const { deps, mockGetJob } = createMockDeps();
        mockGetJob.mockResolvedValue(undefined);

        const service = new ScenarioCancellationService(deps);
        result = await service.cancelJob(defaultJobParams);
      });

      it("returns cancelled: false", () => {
        expect(result).toEqual({ cancelled: false });
      });
    });
  });

  describe("cancelBatchRun()", () => {
    describe("when a batch has jobs in mixed states", () => {
      let result: { cancelledCount: number; skippedCount: number };
      let mockGetJob: ReturnType<typeof vi.fn>;
      let mockPublishCancellation: ReturnType<typeof vi.fn>;
      let mockRemoveRun1: ReturnType<typeof vi.fn>;

      beforeEach(async () => {
        const { deps, mockGetJob: getJobFn, mockPublishCancellation: publishFn, mockGetQueuedJobs } = createMockDeps();
        mockGetJob = getJobFn;
        mockPublishCancellation = publishFn;

        mockRemoveRun1 = vi.fn().mockResolvedValue(undefined);

        mockGetJob.mockImplementation(async (jobId: string) => {
          if (jobId === "run1") return { getState: vi.fn().mockResolvedValue("waiting"), remove: mockRemoveRun1 };
          if (jobId === "run2") return { getState: vi.fn().mockResolvedValue("active") };
          return undefined;
        });

        mockGetQueuedJobs.mockResolvedValue([
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

      it("removes the queued BullMQ job for the pending run", () => {
        expect(mockRemoveRun1).toHaveBeenCalled();
      });

      it("publishes a cancellation signal for the active run", () => {
        expect(mockPublishCancellation).toHaveBeenCalledWith(
          expect.objectContaining({ jobId: "run2" }),
        );
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

      beforeEach(async () => {
        const { deps, mockGetQueuedJobs } = createMockDeps();
        mockGetQueuedJobs.mockResolvedValue([
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

    describe("when no jobs exist for the batch", () => {
      let result: { cancelledCount: number; skippedCount: number };

      beforeEach(async () => {
        const { deps, mockGetQueuedJobs } = createMockDeps();
        mockGetQueuedJobs.mockResolvedValue([]);

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
        const { deps, mockGetJob, mockGetQueuedJobs } = createMockDeps();
        let concurrentCount = 0;
        let maxConcurrent = 0;

        // Mock getJob to simulate a slow remove operation
        mockGetJob.mockImplementation(async () => ({
          getState: vi.fn().mockResolvedValue("waiting"),
          remove: vi.fn().mockImplementation(async () => {
            concurrentCount++;
            maxConcurrent = Math.max(maxConcurrent, concurrentCount);
            await new Promise((r) => setTimeout(r, 10));
            concurrentCount--;
          }),
        }));

        mockGetQueuedJobs.mockResolvedValue(
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
