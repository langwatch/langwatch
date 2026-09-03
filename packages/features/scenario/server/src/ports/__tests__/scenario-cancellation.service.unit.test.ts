/**
 * Cancellation tests for the canonical ScenarioService.
 *
 * The service uses event-sourcing for cancellation:
 * - Dispatches cancel_requested event (always)
 * - The simulationRunExecution process manager takes it from there:
 *   queued runs are finished CANCELLED by the process manager itself;
 *   active runs are broadcast to workers, and the owning worker kills the child
 *
 * @see specs/features/suites/cancel-queued-running-jobs.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SimulationService } from "@langwatch/scenario-contract";
import { ScenarioRunStatus } from "@langwatch/scenario-contract";
import { ScenarioRepository } from "../../repositories/scenario.repository";
import { ScenarioService } from "../../services/scenario.service";
import { ScenarioClockPort } from "../scenario-clock.port";
import { ScenarioTestSuiteIdPort, ScenarioIdPort } from "../scenario-id.port";
import { ScenarioSecretCipherPort } from "../scenario-secret-cipher.port";

class CancellationTestSecretCipher extends ScenarioSecretCipherPort {
  encrypt(value: string): string {
    return value;
  }

  decrypt(value: string): string {
    return value;
  }
}

class CancellationTestId extends ScenarioIdPort {
  next(): string {
    return "unused";
  }
}

class CancellationTestTestSuiteId extends ScenarioTestSuiteIdPort {
  next(): string {
    return "test_suite_unused";
  }
}

class CancellationTestClock extends ScenarioClockPort {
  now(): Date {
    return new Date(0);
  }
}

function createMockDeps(): {
  deps: SimulationService;
  mockGetRunsForBatch: ReturnType<typeof vi.fn>;
  mockDispatchCancelRequested: ReturnType<typeof vi.fn>;
} {
  const mockGetRunsForBatch = vi.fn().mockResolvedValue([]);
  const mockDispatchCancelRequested = vi.fn().mockResolvedValue(undefined);

  const deps = Object.assign(Object.create(SimulationService.prototype), {
    getRunDataForBatchRun: async (input: {
      projectId: string;
      scenarioSetId?: string;
      batchRunId: string;
      sinceTimestamp?: number;
    }) => ({
      changed: true as const,
      runs: await mockGetRunsForBatch(input),
      lastUpdatedAt: 0,
    }),
    cancelRun: (input: { tenantId: string; scenarioRunId: string; occurredAt: number }) =>
      mockDispatchCancelRequested(input),
  }) as SimulationService;

  return {
    deps,
    mockGetRunsForBatch,
    mockDispatchCancelRequested,
  };
}

const defaultJobParams = {
  projectId: "proj1",
  scenarioSetId: "set1",
  batchRunId: "batch1",
  scenarioRunId: "run1",
  scenarioId: "sc1",
};

function createService(simulations: SimulationService): ScenarioService {
  const repository = Object.create(ScenarioRepository.prototype) as ScenarioRepository;
  return ScenarioService.create({
    repository,
    simulations,
    ids: new CancellationTestId(),
    testSuiteIds: new CancellationTestTestSuiteId(),
    clock: new CancellationTestClock(),
    secretCipher: new CancellationTestSecretCipher(),
  });
}

describe("ScenarioService cancellation", () => {
  describe("cancelJob()", () => {
    function stubRunStatus(mock: ReturnType<typeof vi.fn>, status: ScenarioRunStatus) {
      mock.mockResolvedValue([
        {
          scenarioRunId: "run1",
          scenarioId: "sc1",
          batchRunId: "batch1",
          status,
        },
      ]);
    }

    describe("when the run is already terminal (e.g. SUCCESS)", () => {
      let result: { cancelled: boolean };
      let mockDispatchCancelRequested: ReturnType<typeof vi.fn>;

      beforeEach(async () => {
        const {
          deps,
          mockGetRunsForBatch,
          mockDispatchCancelRequested: cancelFn,
        } = createMockDeps();
        mockDispatchCancelRequested = cancelFn;
        stubRunStatus(mockGetRunsForBatch, ScenarioRunStatus.SUCCESS);

        const service = createService(deps);
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

      beforeEach(async () => {
        const {
          deps,
          mockGetRunsForBatch,
          mockDispatchCancelRequested: cancelFn,
        } = createMockDeps();
        mockDispatchCancelRequested = cancelFn;
        stubRunStatus(mockGetRunsForBatch, ScenarioRunStatus.QUEUED);

        const service = createService(deps);
        result = await service.cancelJob(defaultJobParams);
      });

      /** @scenario "Cancel request produces a cancel_requested event" */
      it("dispatches cancel_requested event", () => {
        expect(mockDispatchCancelRequested).toHaveBeenCalledWith(
          expect.objectContaining({
            tenantId: "proj1",
            scenarioRunId: "run1",
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

      beforeEach(async () => {
        const {
          deps,
          mockGetRunsForBatch,
          mockDispatchCancelRequested: cancelFn,
        } = createMockDeps();
        mockDispatchCancelRequested = cancelFn;
        stubRunStatus(mockGetRunsForBatch, ScenarioRunStatus.IN_PROGRESS);

        const service = createService(deps);
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

      it("returns cancelled: true", () => {
        expect(result).toEqual({ cancelled: true });
      });
    });

    describe("when run is not found in projection", () => {
      let result: { cancelled: boolean };
      let mockDispatchCancelRequested: ReturnType<typeof vi.fn>;

      beforeEach(async () => {
        const {
          deps,
          mockGetRunsForBatch,
          mockDispatchCancelRequested: cancelFn,
        } = createMockDeps();
        mockDispatchCancelRequested = cancelFn;
        mockGetRunsForBatch.mockResolvedValue([]);

        const service = createService(deps);
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
        const {
          deps,
          mockGetRunsForBatch,
          mockDispatchCancelRequested: cancelFn,
        } = createMockDeps();
        mockDispatchCancelRequested = cancelFn;

        mockGetRunsForBatch.mockResolvedValue([
          {
            scenarioRunId: "run1",
            scenarioId: "sc1",
            batchRunId: "batch1",
            status: ScenarioRunStatus.PENDING,
          },
          {
            scenarioRunId: "run2",
            scenarioId: "sc2",
            batchRunId: "batch1",
            status: ScenarioRunStatus.IN_PROGRESS,
          },
          {
            scenarioRunId: "run3",
            scenarioId: "sc3",
            batchRunId: "batch1",
            status: ScenarioRunStatus.SUCCESS,
          },
        ]);

        const service = createService(deps);
        result = await service.cancelBatchRun({
          projectId: "proj1",
          scenarioSetId: "set1",
          batchRunId: "batch1",
        });
      });

      /** @scenario "Batch cancel dispatches cancel events for all non-terminal runs" */
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

    describe("when the batch is large", () => {
      /**
       * `cancelBatchRun` used to call `cancelJob` per run, and `cancelJob`
       * re-read the same batch to check a status `cancelBatchRun` had already
       * filtered on — so a 100-run batch issued 101 ClickHouse reads. The
       * re-read guarded nothing: `handleSimulationRunCancelRequested` only
       * stamps `CancellationRequestedAt` and never changes a run's status, so a
       * cancel landing on a run that has since finished is inert.
       */
      it("reads the batch once, whatever the run count", async () => {
        const { deps, mockGetRunsForBatch, mockDispatchCancelRequested } = createMockDeps();
        mockGetRunsForBatch.mockResolvedValue(
          Array.from({ length: 100 }, (_unused, index) => ({
            scenarioRunId: `run${index}`,
            scenarioId: `sc${index}`,
            batchRunId: "batch1",
            status: ScenarioRunStatus.IN_PROGRESS,
          })),
        );

        const service = createService(deps);
        const result = await service.cancelBatchRun({
          projectId: "proj1",
          scenarioSetId: "set1",
          batchRunId: "batch1",
        });

        expect(result.cancelledCount).toBe(100);
        expect(mockDispatchCancelRequested).toHaveBeenCalledTimes(100);
        expect(mockGetRunsForBatch).toHaveBeenCalledTimes(1);
      });
    });

    describe("when all runs are completed", () => {
      it("returns zero cancelled count", async () => {
        const { deps, mockGetRunsForBatch } = createMockDeps();
        mockGetRunsForBatch.mockResolvedValue([
          {
            scenarioRunId: "run1",
            scenarioId: "sc1",
            batchRunId: "batch1",
            status: ScenarioRunStatus.SUCCESS,
          },
        ]);

        const service = createService(deps);
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

        const service = createService(deps);
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
