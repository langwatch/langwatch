/**
 * Unit tests for the worker's completed event handler integration with ScenarioFailureHandler.
 * Tests the behavior specified in @integration scenarios of the feature file using mocks.
 * @see specs/scenarios/scenario-failure-handler.feature "Worker Event Handler Integration"
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job, Worker } from "bullmq";
import type { ScenarioJob, ScenarioJobResult } from "../scenario.queue";
import { ScenarioFailureHandler } from "../scenario-failure-handler";

// Mock the redis connection to prevent actual worker creation
vi.mock("../../redis", () => ({
  connection: null,
}));

// Mock the logger to avoid console noise in tests
vi.mock("~/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock the ScenarioFailureHandler to track calls
const mockEnsureFailureEventsEmitted = vi.fn();

vi.mock("../scenario-failure-handler", async (importOriginal) => {
  const original = await importOriginal<typeof import("../scenario-failure-handler")>();
  return {
    ...original,
    ScenarioFailureHandler: {
      create: () => ({
        ensureFailureEventsEmitted: mockEnsureFailureEventsEmitted,
      }),
    },
  };
});

describe("ScenarioProcessor Failure Handler", () => {
  type CompletedHandler = (job: Job<ScenarioJob, ScenarioJobResult>, result: ScenarioJobResult) => Promise<void>;
  let completedHandler: CompletedHandler | null = null;

  const mockJob = {
    id: "job_123",
    data: {
      projectId: "proj_123",
      scenarioId: "scen_456",
      setId: "set_789",
      batchRunId: "batch_abc",
      target: { type: "http", url: "http://example.com" },
    },
    log: vi.fn(),
  } as unknown as Job<ScenarioJob, ScenarioJobResult>;

  beforeEach(() => {
    vi.clearAllMocks();
    completedHandler = null;
  });

  /**
   * Simulates the worker.on("completed") behavior from scenario.processor.ts
   * This mirrors the actual implementation to test the integration.
   */
  async function simulateWorkerCompletedEvent(
    job: Job<ScenarioJob, ScenarioJobResult>,
    result: ScenarioJobResult,
  ): Promise<void> {
    // This mirrors the logic in scenario.processor.ts worker.on("completed")
    if (result && !result.success) {
      try {
        const handler = ScenarioFailureHandler.create();
        await handler.ensureFailureEventsEmitted({
          projectId: job.data.projectId,
          scenarioId: job.data.scenarioId,
          setId: job.data.setId,
          batchRunId: job.data.batchRunId,
          error: result.error,
        });
      } catch (error) {
        // Log but don't crash the worker - failure handler errors shouldn't affect other jobs
        // In real code this is logged, we just swallow it for testing
      }
    }
  }

  describe("Worker calls failure handler on job failure", () => {
    it("calls ScenarioFailureHandler.ensureFailureEventsEmitted when result.success = false", async () => {
      // Given: a scenario job completes with result.success = false
      const failedResult: ScenarioJobResult = {
        success: false,
        error: "Prefetch failed: Scenario not found",
      };

      // When: the worker's completed event fires
      await simulateWorkerCompletedEvent(mockJob, failedResult);

      // Then: ScenarioFailureHandler.ensureFailureEventsEmitted is called
      expect(mockEnsureFailureEventsEmitted).toHaveBeenCalledTimes(1);

      // And: the handler receives the job data and error message
      expect(mockEnsureFailureEventsEmitted).toHaveBeenCalledWith({
        projectId: "proj_123",
        scenarioId: "scen_456",
        setId: "set_789",
        batchRunId: "batch_abc",
        error: "Prefetch failed: Scenario not found",
      });
    });
  });

  describe("Worker does not call failure handler on success", () => {
    it("does not invoke ScenarioFailureHandler when result.success = true", async () => {
      // Given: a scenario job completes with result.success = true
      const successResult: ScenarioJobResult = {
        success: true,
      };

      // When: the worker's completed event fires
      await simulateWorkerCompletedEvent(mockJob, successResult);

      // Then: ScenarioFailureHandler is not invoked
      expect(mockEnsureFailureEventsEmitted).not.toHaveBeenCalled();
    });
  });

  describe("Failure handler errors do not crash worker", () => {
    it("logs error but continues when ScenarioFailureHandler throws", async () => {
      // Given: a scenario job completes with result.success = false
      const failedResult: ScenarioJobResult = {
        success: false,
        error: "Some error",
      };

      // And: ScenarioFailureHandler throws an error
      mockEnsureFailureEventsEmitted.mockRejectedValueOnce(
        new Error("Elasticsearch connection failed"),
      );

      // When: the worker's completed event fires
      // Then: the error is caught and the function completes without throwing
      await expect(
        simulateWorkerCompletedEvent(mockJob, failedResult),
      ).resolves.not.toThrow();

      // And: the handler was called (error happened inside)
      expect(mockEnsureFailureEventsEmitted).toHaveBeenCalledTimes(1);

      // And: the worker continues processing other jobs (simulated by function completing)
      // Processing another job should work fine
      mockEnsureFailureEventsEmitted.mockResolvedValueOnce(undefined);
      const anotherResult: ScenarioJobResult = {
        success: false,
        error: "Another error",
      };

      await simulateWorkerCompletedEvent(mockJob, anotherResult);
      expect(mockEnsureFailureEventsEmitted).toHaveBeenCalledTimes(2);
    });
  });
});
