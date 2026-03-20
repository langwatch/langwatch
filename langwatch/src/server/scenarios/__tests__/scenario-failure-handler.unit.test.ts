/**
 * Unit tests for ScenarioFailureHandler service.
 * @see specs/scenarios/scenario-failure-handler.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SimulationFacade } from "~/server/simulations/simulation.facade";
import {
  ScenarioEventType,
  ScenarioRunStatus,
  Verdict,
} from "~/server/scenarios/scenario-event.enums";
import { ScenarioFailureHandler } from "../scenario-failure-handler";

const mockStartRun = vi.fn().mockResolvedValue(undefined);
const mockFinishRun = vi.fn().mockResolvedValue(undefined);

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    simulations: {
      startRun: mockStartRun,
      finishRun: mockFinishRun,
    },
  }),
}));

describe("ScenarioFailureHandler", () => {
  let handler: ScenarioFailureHandler;
  let mockService: {
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
    mockService = {
      getRunDataForBatchRun: vi.fn(),
      saveScenarioEvent: vi.fn(),
    };
    mockStartRun.mockClear();
    mockFinishRun.mockClear();
    handler = new ScenarioFailureHandler(
      mockService as unknown as SimulationFacade,
    );
  });

  describe("ensureFailureEventsEmitted", () => {
    describe("given no events exist for the batch run", () => {
      beforeEach(() => {
        mockService.getRunDataForBatchRun.mockResolvedValue({ changed: true, runs: [] });
      });

      describe("when called with an error", () => {
        it("emits both RUN_STARTED and RUN_FINISHED events", async () => {
          await handler.ensureFailureEventsEmitted({
            ...baseJobData,
            error: "Child process exited with code 1",
          });

          expect(mockService.saveScenarioEvent).toHaveBeenCalledTimes(2);
        });

        it("emits RUN_STARTED with synthetic scenarioRunId", async () => {
          await handler.ensureFailureEventsEmitted({
            ...baseJobData,
            error: "Child process exited with code 1",
          });

          const runStartedCall = mockService.saveScenarioEvent.mock.calls[0]?.[0] as Record<string, unknown>;
          expect(runStartedCall.type).toBe(ScenarioEventType.RUN_STARTED);
          expect(runStartedCall.scenarioRunId).toMatch(/^scenariorun_/);
          expect(runStartedCall.projectId).toBe("proj_123");
        });

        it("emits RUN_FINISHED with status ERROR and error message", async () => {
          await handler.ensureFailureEventsEmitted({
            ...baseJobData,
            error: "Child process exited with code 1",
          });

          const runFinishedCall = mockService.saveScenarioEvent.mock.calls[1]?.[0] as Record<string, unknown>;
          expect(runFinishedCall.type).toBe(ScenarioEventType.RUN_FINISHED);
          expect(runFinishedCall.status).toBe(ScenarioRunStatus.ERROR);
          expect((runFinishedCall.results as Record<string, unknown>).error).toBe("Child process exited with code 1");
        });

        it("uses the same scenarioRunId for both events", async () => {
          await handler.ensureFailureEventsEmitted({
            ...baseJobData,
            error: "Child process exited with code 1",
          });

          const runStartedCall = mockService.saveScenarioEvent.mock.calls[0]?.[0] as Record<string, unknown>;
          const runFinishedCall = mockService.saveScenarioEvent.mock.calls[1]?.[0] as Record<string, unknown>;
          expect(runFinishedCall.scenarioRunId).toBe(runStartedCall.scenarioRunId);
        });

        it("generates scenarioRunId with correct format", async () => {
          await handler.ensureFailureEventsEmitted({
            ...baseJobData,
            error: "Test error",
          });

          const runStartedCall = mockService.saveScenarioEvent.mock.calls[0]?.[0] as Record<string, unknown>;
          expect(runStartedCall.scenarioRunId).toMatch(/^scenariorun_[A-Za-z0-9_-]+$/);
        });

        it("includes all job metadata in events", async () => {
          await handler.ensureFailureEventsEmitted({
            projectId: "proj_123",
            scenarioId: "scen_456",
            setId: "set_789",
            batchRunId: "batch_abc",
            error: "Model API failed",
          });

          const runStartedCall = mockService.saveScenarioEvent.mock.calls[0]?.[0] as Record<string, unknown>;
          expect(runStartedCall.projectId).toBe("proj_123");
          expect(runStartedCall.scenarioId).toBe("scen_456");
          expect(runStartedCall.scenarioSetId).toBe("set_789");
          expect(runStartedCall.batchRunId).toBe("batch_abc");

          const runFinishedCall = mockService.saveScenarioEvent.mock.calls[1]?.[0] as Record<string, unknown>;
          expect(runFinishedCall.projectId).toBe("proj_123");
          expect(runFinishedCall.scenarioId).toBe("scen_456");
          expect(runFinishedCall.scenarioSetId).toBe("set_789");
          expect(runFinishedCall.batchRunId).toBe("batch_abc");
        });
      });
    });

    describe("given no events exist but scenarioRunId is pre-assigned", () => {
      beforeEach(() => {
        mockService.getRunDataForBatchRun.mockResolvedValue({ changed: true, runs: [] });
      });

      describe("when called with a pre-assigned scenarioRunId", () => {
        it("uses the pre-assigned scenarioRunId instead of generating a new one", async () => {
          await handler.ensureFailureEventsEmitted({
            ...baseJobData,
            scenarioRunId: "scenariorun_preassigned123",
            error: "Child process exited with code 1",
          });

          const runStartedCall = mockService.saveScenarioEvent.mock.calls[0]?.[0] as Record<string, unknown>;
          expect(runStartedCall.scenarioRunId).toBe("scenariorun_preassigned123");

          const runFinishedCall = mockService.saveScenarioEvent.mock.calls[1]?.[0] as Record<string, unknown>;
          expect(runFinishedCall.scenarioRunId).toBe("scenariorun_preassigned123");
        });
      });
    });

    describe("given RUN_STARTED event already exists", () => {
      const existingScenarioRunId = "scenariorun_existing123";

      beforeEach(() => {
        mockService.getRunDataForBatchRun.mockResolvedValue({
          changed: true,
          runs: [
            {
              scenarioRunId: existingScenarioRunId,
              scenarioId: "scen_456",
              batchRunId: "batch_abc",
              status: ScenarioRunStatus.IN_PROGRESS,
              results: null,
              messages: [],
              timestamp: Date.now(),
            },
          ],
        });
      });

      describe("when called with an error", () => {
        it("emits only RUN_FINISHED event", async () => {
          await handler.ensureFailureEventsEmitted({
            ...baseJobData,
            error: "Scenario execution timed out",
          });

          expect(mockService.saveScenarioEvent).toHaveBeenCalledTimes(1);

          const runFinishedCall = mockService.saveScenarioEvent.mock.calls[0]?.[0] as Record<string, unknown>;
          expect(runFinishedCall.type).toBe(ScenarioEventType.RUN_FINISHED);
          expect(runFinishedCall.status).toBe(ScenarioRunStatus.ERROR);
        });

        it("uses the existing scenarioRunId", async () => {
          await handler.ensureFailureEventsEmitted({
            ...baseJobData,
            error: "Scenario execution timed out",
          });

          const runFinishedCall = mockService.saveScenarioEvent.mock.calls[0]?.[0] as Record<string, unknown>;
          expect(runFinishedCall.scenarioRunId).toBe(existingScenarioRunId);
        });

        it("does not emit new RUN_STARTED event", async () => {
          await handler.ensureFailureEventsEmitted({
            ...baseJobData,
            error: "Scenario execution timed out",
          });

          const calls = mockService.saveScenarioEvent.mock.calls;
          const runStartedCalls = calls.filter(
            (call: any) => call[0].type === ScenarioEventType.RUN_STARTED,
          );
          expect(runStartedCalls).toHaveLength(0);
        });
      });
    });

    describe("given cancelled flag is true", () => {
      beforeEach(() => {
        mockService.getRunDataForBatchRun.mockResolvedValue({ changed: true, runs: [] });
      });

      describe("when called with cancelled: true", () => {
        it("emits RUN_FINISHED with CANCELLED status instead of ERROR", async () => {
          await handler.ensureFailureEventsEmitted({
            ...baseJobData,
            error: "Cancelled by user",
            cancelled: true,
          });

          const runFinishedCall = mockService.saveScenarioEvent.mock.calls[1]?.[0] as Record<string, unknown>;
          expect(runFinishedCall.type).toBe(ScenarioEventType.RUN_FINISHED);
          expect(runFinishedCall.status).toBe(ScenarioRunStatus.CANCELLED);
        });

        it("uses INCONCLUSIVE verdict for cancelled runs", async () => {
          await handler.ensureFailureEventsEmitted({
            ...baseJobData,
            error: "Cancelled by user",
            cancelled: true,
          });

          const runFinishedCall = mockService.saveScenarioEvent.mock.calls[1]?.[0] as Record<string, unknown>;
          const results = runFinishedCall.results as Record<string, unknown>;
          expect(results.verdict).toBe(Verdict.INCONCLUSIVE);
          expect(results.reasoning).toBe("Cancelled by user");
        });
      });

      describe("when called without cancelled flag", () => {
        it("emits RUN_FINISHED with ERROR status", async () => {
          await handler.ensureFailureEventsEmitted({
            ...baseJobData,
            error: "Child process exited with code 1",
          });

          const runFinishedCall = mockService.saveScenarioEvent.mock.calls[1]?.[0] as Record<string, unknown>;
          expect(runFinishedCall.status).toBe(ScenarioRunStatus.ERROR);
          expect((runFinishedCall.results as Record<string, unknown>).verdict).toBe(Verdict.FAILURE);
        });
      });
    });

    describe("given run already has terminal status", () => {
      describe("when status is ERROR", () => {
        beforeEach(() => {
          mockService.getRunDataForBatchRun.mockResolvedValue({
            changed: true,
            runs: [
              {
                scenarioRunId: "scenariorun_existing123",
                scenarioId: "scen_456",
                batchRunId: "batch_abc",
                status: ScenarioRunStatus.ERROR,
                results: { verdict: Verdict.FAILURE, error: "Previous error" },
                messages: [],
                timestamp: Date.now(),
              },
            ],
          });
        });

        it("emits no events (idempotent)", async () => {
          await handler.ensureFailureEventsEmitted({
            ...baseJobData,
            error: "This error should be ignored",
          });

          expect(mockService.saveScenarioEvent).not.toHaveBeenCalled();
        });
      });

      describe("when status is SUCCESS", () => {
        beforeEach(() => {
          mockService.getRunDataForBatchRun.mockResolvedValue({
            changed: true,
            runs: [
              {
                scenarioRunId: "scenariorun_existing123",
                scenarioId: "scen_456",
                batchRunId: "batch_abc",
                status: ScenarioRunStatus.SUCCESS,
                results: { verdict: Verdict.SUCCESS },
                messages: [],
                timestamp: Date.now(),
              },
            ],
          });
        });

        it("emits no events (trusts existing terminal state)", async () => {
          await handler.ensureFailureEventsEmitted({
            ...baseJobData,
            error: "Spurious error",
          });

          expect(mockService.saveScenarioEvent).not.toHaveBeenCalled();
        });
      });

      describe("when status is FAILED", () => {
        beforeEach(() => {
          mockService.getRunDataForBatchRun.mockResolvedValue({
            changed: true,
            runs: [
              {
                scenarioRunId: "scenariorun_existing123",
                scenarioId: "scen_456",
                batchRunId: "batch_abc",
                status: ScenarioRunStatus.FAILED,
                results: { verdict: Verdict.FAILURE },
                messages: [],
                timestamp: Date.now(),
              },
            ],
          });
        });

        it("emits no events (already in terminal state)", async () => {
          await handler.ensureFailureEventsEmitted({
            ...baseJobData,
            error: "Another error",
          });

          expect(mockService.saveScenarioEvent).not.toHaveBeenCalled();
        });
      });
    });

    describe("ClickHouse dual-write via event-sourcing", () => {
      describe("given no events exist for the batch run", () => {
        beforeEach(() => {
          mockService.getRunDataForBatchRun.mockResolvedValue({ changed: true, runs: [] });
        });

        describe("when called with an error", () => {
          it("dispatches startRun to event-sourcing", async () => {
            await handler.ensureFailureEventsEmitted({
              ...baseJobData,
              error: "Child process exited with code 1",
            });

            expect(mockStartRun).toHaveBeenCalledTimes(1);
            expect(mockStartRun).toHaveBeenCalledWith(
              expect.objectContaining({
                tenantId: "proj_123",
                scenarioId: "scen_456",
                batchRunId: "batch_abc",
                scenarioSetId: "set_789",
              }),
            );
          });

          it("dispatches finishRun to event-sourcing with ERROR status", async () => {
            await handler.ensureFailureEventsEmitted({
              ...baseJobData,
              error: "Child process exited with code 1",
            });

            expect(mockFinishRun).toHaveBeenCalledTimes(1);
            expect(mockFinishRun).toHaveBeenCalledWith(
              expect.objectContaining({
                tenantId: "proj_123",
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
              ...baseJobData,
              error: "Cancelled by user",
              cancelled: true,
            });

            expect(mockFinishRun).toHaveBeenCalledWith(
              expect.objectContaining({
                status: ScenarioRunStatus.CANCELLED,
                results: expect.objectContaining({
                  verdict: Verdict.INCONCLUSIVE,
                }),
              }),
            );
          });
        });
      });

      describe("given RUN_STARTED event already exists", () => {
        beforeEach(() => {
          mockService.getRunDataForBatchRun.mockResolvedValue({
            changed: true,
            runs: [
              {
                scenarioRunId: "scenariorun_existing123",
                scenarioId: "scen_456",
                batchRunId: "batch_abc",
                status: ScenarioRunStatus.IN_PROGRESS,
                results: null,
                messages: [],
                timestamp: Date.now(),
              },
            ],
          });
        });

        describe("when called with an error", () => {
          it("does not dispatch startRun (only finishRun)", async () => {
            await handler.ensureFailureEventsEmitted({
              ...baseJobData,
              error: "Scenario execution timed out",
            });

            expect(mockStartRun).not.toHaveBeenCalled();
            expect(mockFinishRun).toHaveBeenCalledTimes(1);
          });
        });
      });

      describe("given run already has terminal status", () => {
        beforeEach(() => {
          mockService.getRunDataForBatchRun.mockResolvedValue({
            changed: true,
            runs: [
              {
                scenarioRunId: "scenariorun_existing123",
                scenarioId: "scen_456",
                batchRunId: "batch_abc",
                status: ScenarioRunStatus.ERROR,
                results: { verdict: Verdict.FAILURE, error: "Previous error" },
                messages: [],
                timestamp: Date.now(),
              },
            ],
          });
        });

        it("does not dispatch any event-sourcing commands", async () => {
          await handler.ensureFailureEventsEmitted({
            ...baseJobData,
            error: "This error should be ignored",
          });

          expect(mockStartRun).not.toHaveBeenCalled();
          expect(mockFinishRun).not.toHaveBeenCalled();
        });
      });

      describe("when CH dispatch fails", () => {
        beforeEach(() => {
          mockService.getRunDataForBatchRun.mockResolvedValue({ changed: true, runs: [] });
          mockStartRun.mockRejectedValue(new Error("CH unavailable"));
          mockFinishRun.mockRejectedValue(new Error("CH unavailable"));
        });

        it("does not throw (failures are non-fatal)", async () => {
          await expect(
            handler.ensureFailureEventsEmitted({
              ...baseJobData,
              error: "Child process exited with code 1",
            }),
          ).resolves.toBeUndefined();
        });

        it("still writes ES events even when CH fails", async () => {
          await handler.ensureFailureEventsEmitted({
            ...baseJobData,
            error: "Child process exited with code 1",
          });

          expect(mockService.saveScenarioEvent).toHaveBeenCalledTimes(2);
        });
      });
    });
  });
});
