/**
 * Unit tests for race condition guards in cancellation logic.
 *
 * Covers two races:
 * 1. Cancellation arriving after a job already completed with real results
 * 2. Real results arriving after a job was already cancelled
 *
 * @see specs/features/suites/cancel-queued-running-jobs.feature (@unit scenarios)
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ScenarioRunStatus, ScenarioEventType, Verdict } from "../scenario-event.enums";
import { ScenarioCancellationService } from "../cancellation";
import type { CancellationServiceDeps } from "../cancellation";
import { ScenarioEventService } from "../scenario-event.service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createCancellationDeps(
  overrides: Record<string, unknown> = {},
): CancellationServiceDeps {
  const simulationService = {
    saveScenarioEvent: vi.fn().mockResolvedValue(undefined),
    getRunDataForBatchRun: vi.fn().mockResolvedValue({ changed: false, lastUpdatedAt: 0 }),
    getScenarioRunData: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as CancellationServiceDeps["simulationService"];

  return {
    queue: { getJob: vi.fn().mockResolvedValue(undefined) } as CancellationServiceDeps["queue"],
    simulationService,
    publishCancellation: vi.fn().mockResolvedValue(undefined) as CancellationServiceDeps["publishCancellation"],
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

// ---------------------------------------------------------------------------
// Guard 1: cancellation skips jobs that already have terminal results
// ---------------------------------------------------------------------------

describe("ScenarioCancellationService — race guard: cancellation after terminal result", () => {
  describe("when the job already completed with a pass verdict", () => {
    let mockSave: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      mockSave = vi.fn().mockResolvedValue(undefined);
      const deps = createCancellationDeps({
        saveScenarioEvent: mockSave,
        getScenarioRunData: vi.fn().mockResolvedValue({
          scenarioRunId: "run1",
          status: ScenarioRunStatus.SUCCESS,
          results: { verdict: Verdict.SUCCESS, metCriteria: [], unmetCriteria: [] },
        }),
      });

      const service = new ScenarioCancellationService(deps);
      await service.cancelJob(defaultJobParams);
    });

    it("does not persist a cancellation event", () => {
      expect(mockSave).not.toHaveBeenCalled();
    });
  });

  describe("when the job already completed with a fail verdict", () => {
    let mockSave: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      mockSave = vi.fn().mockResolvedValue(undefined);
      const deps = createCancellationDeps({
        saveScenarioEvent: mockSave,
        getScenarioRunData: vi.fn().mockResolvedValue({
          scenarioRunId: "run1",
          status: ScenarioRunStatus.FAILED,
          results: { verdict: Verdict.FAILURE, metCriteria: [], unmetCriteria: ["criteria1"] },
        }),
      });

      const service = new ScenarioCancellationService(deps);
      await service.cancelJob(defaultJobParams);
    });

    it("does not persist a cancellation event", () => {
      expect(mockSave).not.toHaveBeenCalled();
    });
  });

  describe("when the job already completed with an error status", () => {
    let mockSave: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      mockSave = vi.fn().mockResolvedValue(undefined);
      const deps = createCancellationDeps({
        saveScenarioEvent: mockSave,
        getScenarioRunData: vi.fn().mockResolvedValue({
          scenarioRunId: "run1",
          status: ScenarioRunStatus.ERROR,
          results: null,
        }),
      });

      const service = new ScenarioCancellationService(deps);
      await service.cancelJob(defaultJobParams);
    });

    it("does not persist a cancellation event", () => {
      expect(mockSave).not.toHaveBeenCalled();
    });
  });

  describe("when the job has no run data yet (not started)", () => {
    let mockSave: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      mockSave = vi.fn().mockResolvedValue(undefined);
      const deps = createCancellationDeps({
        saveScenarioEvent: mockSave,
        getScenarioRunData: vi.fn().mockResolvedValue(null),
      });

      const service = new ScenarioCancellationService(deps);
      await service.cancelJob(defaultJobParams);
    });

    it("persists a cancellation event", () => {
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ScenarioRunStatus.CANCELLED,
        }),
      );
    });
  });

  describe("when the job is still in-progress", () => {
    let mockSave: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      mockSave = vi.fn().mockResolvedValue(undefined);
      const deps = createCancellationDeps({
        saveScenarioEvent: mockSave,
        getScenarioRunData: vi.fn().mockResolvedValue({
          scenarioRunId: "run1",
          status: ScenarioRunStatus.IN_PROGRESS,
          results: null,
        }),
      });

      const service = new ScenarioCancellationService(deps);
      await service.cancelJob(defaultJobParams);
    });

    it("persists a cancellation event", () => {
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ScenarioRunStatus.CANCELLED,
        }),
      );
    });
  });

  describe("cancellation event payload", () => {
    it("does not include INCONCLUSIVE verdict in the cancellation event", async () => {
      const mockSave = vi.fn().mockResolvedValue(undefined);
      const deps = createCancellationDeps({
        saveScenarioEvent: mockSave,
        getScenarioRunData: vi.fn().mockResolvedValue(null),
      });

      const service = new ScenarioCancellationService(deps);
      await service.cancelJob(defaultJobParams);

      const savedEvent = mockSave.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(savedEvent?.results).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Guard 2: late real results after cancellation
// ---------------------------------------------------------------------------

describe("ScenarioEventService.saveScenarioEvent() — race guard: late results after cancellation", () => {
  function makeFinishedEvent(
    overrides: Partial<{
      status: ScenarioRunStatus;
      verdict: Verdict;
    }> = {},
  ) {
    return {
      projectId: "proj1",
      type: ScenarioEventType.RUN_FINISHED as const,
      scenarioId: "sc1",
      scenarioRunId: "run1",
      batchRunId: "batch1",
      scenarioSetId: "set1",
      timestamp: Date.now(),
      status: overrides.status ?? ScenarioRunStatus.SUCCESS,
      results: {
        verdict: overrides.verdict ?? Verdict.SUCCESS,
        reasoning: "Tests passed",
        metCriteria: ["criteria1"],
        unmetCriteria: [],
      },
    };
  }

  describe("when a RUN_FINISHED event arrives and the run is already CANCELLED", () => {
    describe("when the new event has real (non-INCONCLUSIVE) results", () => {
      let mockSaveEvent: ReturnType<typeof vi.fn>;
      let mockGetLatest: ReturnType<typeof vi.fn>;

      beforeEach(async () => {
        mockSaveEvent = vi.fn().mockResolvedValue(undefined);
        mockGetLatest = vi.fn().mockResolvedValue({
          type: ScenarioEventType.RUN_FINISHED,
          status: ScenarioRunStatus.CANCELLED,
          results: { verdict: Verdict.INCONCLUSIVE, metCriteria: [], unmetCriteria: [] },
          scenarioRunId: "run1",
          scenarioId: "sc1",
          batchRunId: "batch1",
          scenarioSetId: "set1",
          timestamp: Date.now() - 1000,
        });

        const mockRepo = {
          saveEvent: mockSaveEvent,
          getLatestRunFinishedEventByScenarioRunId: mockGetLatest,
        };

        const service = new ScenarioEventService(mockRepo as never);
        await service.saveScenarioEvent(makeFinishedEvent({ status: ScenarioRunStatus.SUCCESS, verdict: Verdict.SUCCESS }));
      });

      it("stores the results data", () => {
        expect(mockSaveEvent).toHaveBeenCalled();
      });

      it("does not change the status from CANCELLED", () => {
        const savedEvent = mockSaveEvent.mock.calls[0]?.[0] as Record<string, unknown>;
        expect(savedEvent?.status).toBe(ScenarioRunStatus.CANCELLED);
      });
    });

    describe("when the new event has INCONCLUSIVE results", () => {
      let mockSaveEvent: ReturnType<typeof vi.fn>;

      beforeEach(async () => {
        mockSaveEvent = vi.fn().mockResolvedValue(undefined);
        const mockGetLatest = vi.fn().mockResolvedValue({
          type: ScenarioEventType.RUN_FINISHED,
          status: ScenarioRunStatus.CANCELLED,
          results: { verdict: Verdict.INCONCLUSIVE, metCriteria: [], unmetCriteria: [] },
          scenarioRunId: "run1",
          scenarioId: "sc1",
          batchRunId: "batch1",
          scenarioSetId: "set1",
          timestamp: Date.now() - 1000,
        });

        const mockRepo = {
          saveEvent: mockSaveEvent,
          getLatestRunFinishedEventByScenarioRunId: mockGetLatest,
        };

        const service = new ScenarioEventService(mockRepo as never);
        await service.saveScenarioEvent(
          makeFinishedEvent({ status: ScenarioRunStatus.CANCELLED, verdict: Verdict.INCONCLUSIVE }),
        );
      });

      it("skips saving the event entirely (idempotent)", () => {
        expect(mockSaveEvent).not.toHaveBeenCalled();
      });
    });
  });

  describe("when a RUN_FINISHED event arrives and the run is not yet cancelled", () => {
    let mockSaveEvent: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      mockSaveEvent = vi.fn().mockResolvedValue(undefined);
      const mockGetLatest = vi.fn().mockResolvedValue(null);

      const mockRepo = {
        saveEvent: mockSaveEvent,
        getLatestRunFinishedEventByScenarioRunId: mockGetLatest,
      };

      const service = new ScenarioEventService(mockRepo as never);
      await service.saveScenarioEvent(makeFinishedEvent({ status: ScenarioRunStatus.SUCCESS }));
    });

    it("saves the event normally", () => {
      expect(mockSaveEvent).toHaveBeenCalledWith(
        expect.objectContaining({ status: ScenarioRunStatus.SUCCESS }),
      );
    });
  });
});
