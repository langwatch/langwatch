/**
 * Unit tests for ScenarioFailureHandler service.
 * @see specs/scenarios/scenario-failure-handler.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScenarioEventService } from "~/app/api/scenario-events/[[...route]]/scenario-event.service";
import {
  ScenarioEventType,
  ScenarioRunStatus,
} from "~/app/api/scenario-events/[[...route]]/enums";
import { Verdict } from "~/app/api/scenario-events/[[...route]]/enums";
import { ScenarioFailureHandler } from "../scenario-failure-handler";

describe("ScenarioFailureHandler", () => {
  let handler: ScenarioFailureHandler;
  let mockEventService: {
    getRunDataForBatchRun: ReturnType<typeof vi.fn>;
    saveScenarioEvent: ReturnType<typeof vi.fn>;
  };

  const baseJobData = {
    projectId: "proj_123",
    scenarioId: "scen_456",
    setId: "set_789",
    batchRunId: "batch_abc",
  };

  beforeEach(() => {
    mockEventService = {
      getRunDataForBatchRun: vi.fn(),
      saveScenarioEvent: vi.fn(),
    };
    handler = new ScenarioFailureHandler(
      mockEventService as unknown as ScenarioEventService,
    );
  });

  describe("ensureFailureEventsEmitted", () => {
    it("emits both RUN_STARTED and RUN_FINISHED when no events exist", async () => {
      // Given: no events exist in Elasticsearch for this batchRunId
      mockEventService.getRunDataForBatchRun.mockResolvedValue([]);

      // When: ScenarioFailureHandler.ensureFailureEventsEmitted is called
      await handler.ensureFailureEventsEmitted({
        ...baseJobData,
        error: "Child process exited with code 1",
      });

      // Then: a RUN_STARTED event is emitted with a synthetic scenarioRunId
      expect(mockEventService.saveScenarioEvent).toHaveBeenCalledTimes(2);

      const runStartedCall = mockEventService.saveScenarioEvent.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(runStartedCall.type).toBe(ScenarioEventType.RUN_STARTED);
      expect(runStartedCall.scenarioRunId).toMatch(/^scenariorun_/);
      expect(runStartedCall.projectId).toBe("proj_123");

      // And: a RUN_FINISHED event is emitted with status ERROR
      const runFinishedCall = mockEventService.saveScenarioEvent.mock.calls[1]?.[0] as Record<string, unknown>;
      expect(runFinishedCall.type).toBe(ScenarioEventType.RUN_FINISHED);
      expect(runFinishedCall.status).toBe(ScenarioRunStatus.ERROR);

      // And: the RUN_FINISHED event includes the error message
      expect((runFinishedCall.results as Record<string, unknown>).error).toBe("Child process exited with code 1");

      // And: both events share the same scenarioRunId
      expect(runFinishedCall.scenarioRunId).toBe(runStartedCall.scenarioRunId);
    });

    it("emits only RUN_FINISHED when RUN_STARTED exists", async () => {
      // Given: a RUN_STARTED event exists for this batchRunId
      const existingScenarioRunId = "scenariorun_existing123";
      mockEventService.getRunDataForBatchRun.mockResolvedValue([
        {
          scenarioRunId: existingScenarioRunId,
          scenarioId: "scen_456",
          batchRunId: "batch_abc",
          status: ScenarioRunStatus.IN_PROGRESS,
          results: null,
          messages: [],
          timestamp: Date.now(),
        },
      ]);

      // When: ScenarioFailureHandler.ensureFailureEventsEmitted is called
      await handler.ensureFailureEventsEmitted({
        ...baseJobData,
        error: "Scenario execution timed out",
      });

      // Then: a RUN_FINISHED event is emitted with status ERROR
      expect(mockEventService.saveScenarioEvent).toHaveBeenCalledTimes(1);

      const runFinishedCall = mockEventService.saveScenarioEvent.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(runFinishedCall.type).toBe(ScenarioEventType.RUN_FINISHED);
      expect(runFinishedCall.status).toBe(ScenarioRunStatus.ERROR);

      // And: the RUN_FINISHED uses the existing scenarioRunId from RUN_STARTED
      expect(runFinishedCall.scenarioRunId).toBe(existingScenarioRunId);

      // And: no new RUN_STARTED event is emitted
      const calls = mockEventService.saveScenarioEvent.mock.calls;
      const runStartedCalls = calls.filter(
        (call: any) => call[0].type === ScenarioEventType.RUN_STARTED,
      );
      expect(runStartedCalls).toHaveLength(0);
    });

    it("emits nothing when RUN_FINISHED already exists (idempotent)", async () => {
      // Given: both RUN_STARTED and RUN_FINISHED events exist for this batchRunId
      mockEventService.getRunDataForBatchRun.mockResolvedValue([
        {
          scenarioRunId: "scenariorun_existing123",
          scenarioId: "scen_456",
          batchRunId: "batch_abc",
          status: ScenarioRunStatus.ERROR, // Run is already finished
          results: { verdict: Verdict.FAILURE, error: "Previous error" },
          messages: [],
          timestamp: Date.now(),
        },
      ]);

      // When: ScenarioFailureHandler.ensureFailureEventsEmitted is called
      await handler.ensureFailureEventsEmitted({
        ...baseJobData,
        error: "This error should be ignored",
      });

      // Then: no events are emitted
      expect(mockEventService.saveScenarioEvent).not.toHaveBeenCalled();

      // And: the handler returns successfully (no error thrown)
    });

    it("generates synthetic scenarioRunId with correct format", async () => {
      // Given: no events exist in Elasticsearch
      mockEventService.getRunDataForBatchRun.mockResolvedValue([]);

      // When: the handler generates a synthetic scenarioRunId
      await handler.ensureFailureEventsEmitted({
        ...baseJobData,
        error: "Test error",
      });

      // Then: the ID follows the pattern "scenariorun_{nanoid}"
      const runStartedCall = mockEventService.saveScenarioEvent.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(runStartedCall.scenarioRunId).toMatch(/^scenariorun_[A-Za-z0-9_-]+$/);
    });

    it("includes job metadata in failure events", async () => {
      // Given: a scenario job failed with specific metadata
      mockEventService.getRunDataForBatchRun.mockResolvedValue([]);

      const jobData = {
        projectId: "proj_123",
        scenarioId: "scen_456",
        setId: "set_789",
        batchRunId: "batch_abc",
        error: "Model API failed",
      };

      // When: ScenarioFailureHandler.ensureFailureEventsEmitted is called
      await handler.ensureFailureEventsEmitted(jobData);

      // Then: the emitted events include all required fields
      const runStartedCall = mockEventService.saveScenarioEvent.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(runStartedCall.projectId).toBe("proj_123");
      expect(runStartedCall.scenarioId).toBe("scen_456");
      expect(runStartedCall.scenarioSetId).toBe("set_789");
      expect(runStartedCall.batchRunId).toBe("batch_abc");

      const runFinishedCall = mockEventService.saveScenarioEvent.mock.calls[1]?.[0] as Record<string, unknown>;
      expect(runFinishedCall.projectId).toBe("proj_123");
      expect(runFinishedCall.scenarioId).toBe("scen_456");
      expect(runFinishedCall.scenarioSetId).toBe("set_789");
      expect(runFinishedCall.batchRunId).toBe("batch_abc");
    });

    it("handles SUCCESS status as terminal (does not emit events)", async () => {
      // Given: a completed run with SUCCESS status exists
      mockEventService.getRunDataForBatchRun.mockResolvedValue([
        {
          scenarioRunId: "scenariorun_existing123",
          scenarioId: "scen_456",
          batchRunId: "batch_abc",
          status: ScenarioRunStatus.SUCCESS,
          results: { verdict: Verdict.SUCCESS },
          messages: [],
          timestamp: Date.now(),
        },
      ]);

      // When: handler is called (somehow job marked as failed but events show success)
      await handler.ensureFailureEventsEmitted({
        ...baseJobData,
        error: "Spurious error",
      });

      // Then: no events are emitted (trust the existing terminal state)
      expect(mockEventService.saveScenarioEvent).not.toHaveBeenCalled();
    });

    it("handles FAILED status as terminal (does not emit events)", async () => {
      // Given: a completed run with FAILED status exists
      mockEventService.getRunDataForBatchRun.mockResolvedValue([
        {
          scenarioRunId: "scenariorun_existing123",
          scenarioId: "scen_456",
          batchRunId: "batch_abc",
          status: ScenarioRunStatus.FAILED,
          results: { verdict: Verdict.FAILURE },
          messages: [],
          timestamp: Date.now(),
        },
      ]);

      // When: handler is called
      await handler.ensureFailureEventsEmitted({
        ...baseJobData,
        error: "Another error",
      });

      // Then: no events are emitted (already in terminal state)
      expect(mockEventService.saveScenarioEvent).not.toHaveBeenCalled();
    });
  });
});
