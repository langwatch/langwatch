/**
 * Unit tests for ScenarioFailureHandler service.
 * @see specs/scenarios/scenario-failure-handler.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ScenarioRunStatus,
  Verdict,
} from "~/server/scenarios/scenario-event.enums";
import { ScenarioFailureHandler } from "../scenario-failure-handler";

const mockFinishRun = vi.fn().mockResolvedValue(undefined);

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    simulations: {
      finishRun: mockFinishRun,
    },
  }),
}));

describe("ScenarioFailureHandler", () => {
  let handler: ScenarioFailureHandler;

  const baseParams = {
    projectId: "proj_123",
    scenarioId: "scen_456",
    setId: "set_789",
    batchRunId: "batch_abc",
    scenarioRunId: "scenariorun_preassigned123",
  };

  beforeEach(() => {
    mockFinishRun.mockClear();
    handler = ScenarioFailureHandler.create();
  });

  describe("when called with an error", () => {
    it("dispatches finishRun with ERROR status", async () => {
      await handler.ensureFailureEventsEmitted({
        ...baseParams,
        error: "Child process exited with code 1",
      });

      expect(mockFinishRun).toHaveBeenCalledTimes(1);
      expect(mockFinishRun).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "proj_123",
          scenarioRunId: "scenariorun_preassigned123",
          status: ScenarioRunStatus.ERROR,
          results: expect.objectContaining({
            verdict: Verdict.FAILURE,
            error: "Child process exited with code 1",
          }),
        }),
      );
    });
  });

  describe("when called with cancelled: true", () => {
    it("dispatches finishRun with CANCELLED status", async () => {
      await handler.ensureFailureEventsEmitted({
        ...baseParams,
        error: "Cancelled by user",
        cancelled: true,
      });

      expect(mockFinishRun).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ScenarioRunStatus.CANCELLED,
          results: expect.objectContaining({
            verdict: Verdict.INCONCLUSIVE,
            reasoning: "Cancelled by user",
          }),
        }),
      );
    });
  });

  describe("when scenarioRunId is not provided", () => {
    it("does not dispatch any events", async () => {
      await handler.ensureFailureEventsEmitted({
        projectId: "proj_123",
        scenarioId: "scen_456",
        setId: "set_789",
        batchRunId: "batch_abc",
        error: "Some error",
      });

      expect(mockFinishRun).not.toHaveBeenCalled();
    });
  });

  describe("when finishRun fails", () => {
    it("propagates the error", async () => {
      mockFinishRun.mockRejectedValue(new Error("CH unavailable"));

      await expect(
        handler.ensureFailureEventsEmitted({
          ...baseParams,
          error: "Child process exited with code 1",
        }),
      ).rejects.toThrow("CH unavailable");
    });
  });
});
