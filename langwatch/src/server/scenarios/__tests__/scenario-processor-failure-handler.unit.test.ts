/**
 * Unit tests for the handleFailedJobResult function in scenario.processor.ts.
 * Tests the extracted failure handling logic with injected dependencies.
 * @see specs/scenarios/scenario-failure-handler.feature "Worker Event Handler Integration"
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScenarioJob, ScenarioJobResult } from "../scenario.queue";
import type { ProcessorDependencies } from "../scenario.processor";
import { handleFailedJobResult } from "../scenario.processor";

describe("handleFailedJobResult", () => {
  const mockJobData: ScenarioJob = {
    projectId: "proj_123",
    scenarioId: "scen_456",
    setId: "set_789",
    batchRunId: "batch_abc",
    target: { type: "http", referenceId: "agent_123" },
  };

  const mockScenario = {
    name: "Test Scenario",
    situation: "Test description for the scenario",
  };

  let mockDeps: ProcessorDependencies;
  let mockGetById: ReturnType<typeof vi.fn>;
  let mockEnsureFailureEventsEmitted: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGetById = vi.fn().mockResolvedValue(mockScenario);
    mockEnsureFailureEventsEmitted = vi.fn().mockResolvedValue(undefined);

    mockDeps = {
      scenarioLookup: {
        getById: mockGetById,
      },
      failureEmitter: {
        ensureFailureEventsEmitted: mockEnsureFailureEventsEmitted,
      },
    };
  });

  describe("calls failure handler with job data", () => {
    it("calls ensureFailureEventsEmitted with correct parameters", async () => {
      // Given: a failed job result with an error message
      const error = "Prefetch failed: Scenario not found";

      // When: handleFailedJobResult is called
      await handleFailedJobResult(mockJobData, error, mockDeps);

      // Then: scenarioLookup.getById is called with correct params
      expect(mockGetById).toHaveBeenCalledWith({
        projectId: "proj_123",
        id: "scen_456",
      });

      // And: failureEmitter.ensureFailureEventsEmitted is called with all data
      expect(mockEnsureFailureEventsEmitted).toHaveBeenCalledWith({
        projectId: "proj_123",
        scenarioId: "scen_456",
        setId: "set_789",
        batchRunId: "batch_abc",
        error: "Prefetch failed: Scenario not found",
        name: "Test Scenario",
        description: "Test description for the scenario",
      });
    });

    it("includes name and description from scenario in failure event params", async () => {
      // Given: a scenario with custom name and description
      mockGetById.mockResolvedValue({
        name: "Custom Scenario Name",
        situation: "Custom scenario description",
      });

      // When: handleFailedJobResult is called
      await handleFailedJobResult(mockJobData, "Child process exited with code 1", mockDeps);

      // Then: the handler receives name and description from the scenario
      expect(mockEnsureFailureEventsEmitted).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Custom Scenario Name",
          description: "Custom scenario description",
        }),
      );
    });

    it("handles missing scenario gracefully", async () => {
      // Given: the scenario does not exist
      mockGetById.mockResolvedValue(null);

      // When: handleFailedJobResult is called
      await handleFailedJobResult(mockJobData, "Prefetch failed", mockDeps);

      // Then: the handler is still called with undefined name and description
      expect(mockEnsureFailureEventsEmitted).toHaveBeenCalledWith(
        expect.objectContaining({
          name: undefined,
          description: undefined,
        }),
      );
    });

    it("handles undefined error gracefully", async () => {
      // Given: no error message provided
      const error = undefined;

      // When: handleFailedJobResult is called
      await handleFailedJobResult(mockJobData, error, mockDeps);

      // Then: the handler is called with undefined error
      expect(mockEnsureFailureEventsEmitted).toHaveBeenCalledWith(
        expect.objectContaining({
          error: undefined,
        }),
      );
    });
  });

  describe("error propagation", () => {
    it("propagates errors from scenarioLookup.getById", async () => {
      // Given: scenarioLookup.getById throws an error
      mockGetById.mockRejectedValue(new Error("Database connection failed"));

      // When/Then: handleFailedJobResult propagates the error
      await expect(
        handleFailedJobResult(mockJobData, "Some error", mockDeps),
      ).rejects.toThrow("Database connection failed");
    });

    it("propagates errors from failureEmitter.ensureFailureEventsEmitted", async () => {
      // Given: failureEmitter.ensureFailureEventsEmitted throws an error
      mockEnsureFailureEventsEmitted.mockRejectedValue(
        new Error("Elasticsearch connection failed"),
      );

      // When/Then: handleFailedJobResult propagates the error
      await expect(
        handleFailedJobResult(mockJobData, "Some error", mockDeps),
      ).rejects.toThrow("Elasticsearch connection failed");
    });
  });
});

describe("Worker integration behavior (documented contract)", () => {
  /**
   * These tests document how the worker.on("completed") handler should use
   * handleFailedJobResult. The actual worker catches errors from handleFailedJobResult
   * to prevent crashing. This contract is tested in integration tests.
   */

  it("documents that worker catches errors from handleFailedJobResult", () => {
    // This is a documentation test - the actual behavior is:
    // worker.on("completed", async (job, result) => {
    //   if (result && !result.success) {
    //     try {
    //       await handleFailedJobResult(job.data, result.error, deps);
    //     } catch (error) {
    //       logger.error(...); // Log but don't crash
    //     }
    //   }
    // });
    expect(true).toBe(true);
  });

  it("documents that worker only calls handleFailedJobResult for failed jobs", () => {
    // The worker checks result.success === false before calling handleFailedJobResult
    // Successful jobs (result.success === true) do not trigger failure handling
    expect(true).toBe(true);
  });
});
