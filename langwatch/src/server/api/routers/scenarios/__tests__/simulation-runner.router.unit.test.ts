/**
 * @vitest-environment node
 *
 * Unit tests for simulation-runner.router API-level validation.
 *
 * Tests that early validation errors are returned immediately from the API
 * (not scheduled as async jobs), providing instant feedback to the frontend.
 *
 * @see specs/scenarios/simulation-runner.feature - Error Handling - Early Validation
 */

import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before importing the router
vi.mock("~/server/scenarios/execution/data-prefetcher", () => ({
  prefetchScenarioData: vi.fn(),
}));

vi.mock("~/server/scenarios/scenario.queue", () => ({
  generateBatchRunId: vi.fn().mockReturnValue("batch_test_123"),
  scheduleScenarioRun: vi.fn().mockResolvedValue({ id: "job_test_123" }),
}));

vi.mock("~/utils/logger", () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock RBAC to always allow - we're testing business logic, not permissions
vi.mock("../../../rbac", () => ({
  checkProjectPermission: vi.fn().mockImplementation(() => {
    return async ({ ctx, next, input }: any) => {
      return next({
        ctx: { ...ctx, permissionChecked: true },
      });
    };
  }),
}));

// Import mocked functions after mocking
import { prefetchScenarioData } from "~/server/scenarios/execution/data-prefetcher";
import { scheduleScenarioRun } from "~/server/scenarios/scenario.queue";
import { simulationRunnerRouter } from "../simulation-runner.router";
import { createInnerTRPCContext } from "../../../trpc";

const mockPrefetchScenarioData = vi.mocked(prefetchScenarioData);
const mockScheduleScenarioRun = vi.mocked(scheduleScenarioRun);

// Create a caller for the router
function createTestCaller() {
  const ctx = createInnerTRPCContext({
    session: {
      user: { id: "user_test_123" },
      expires: "2099-01-01",
    } as any,
  });
  // Create a minimal router just for this test
  // We use the simulationRunnerRouter directly
  return simulationRunnerRouter.createCaller({ ...ctx, permissionChecked: true });
}

describe("simulationRunnerRouter.run - API-level validation", () => {
  const defaultInput = {
    projectId: "proj_123",
    scenarioId: "scen_123",
    target: { type: "prompt" as const, referenceId: "prompt_123" },
  };

  let caller: ReturnType<typeof createTestCaller>;

  beforeEach(() => {
    vi.clearAllMocks();
    caller = createTestCaller();
  });

  describe("Return immediate error when project default model not configured", () => {
    /**
     * @feature specs/scenarios/simulation-runner.feature
     * @scenario Return immediate error when project default model not configured
     */
    it("throws TRPCError with BAD_REQUEST when project has no default model", async () => {
      // Given: project has no default model configured
      mockPrefetchScenarioData.mockResolvedValue({
        success: false,
        error: "Project default model is not configured",
      });

      // When: the run scenario API is called
      // Then: it returns an immediate error (not scheduled)
      await expect(caller.run(defaultInput)).rejects.toThrow(TRPCError);

      try {
        await caller.run(defaultInput);
      } catch (error) {
        // And: the error message is "Project default model is not configured"
        expect(error).toBeInstanceOf(TRPCError);
        const trpcError = error as TRPCError;
        expect(trpcError.code).toBe("BAD_REQUEST");
        expect(trpcError.message).toBe("Project default model is not configured");
      }

      // And: scheduleScenarioRun is NOT called when validation fails
      expect(mockScheduleScenarioRun).not.toHaveBeenCalled();
    });
  });

  describe("Return immediate error when scenario not found", () => {
    /**
     * @feature specs/scenarios/simulation-runner.feature
     * @scenario Return immediate error when scenario not found
     */
    it("throws TRPCError with BAD_REQUEST when scenario does not exist", async () => {
      // Given: scenario "nonexistent" does not exist
      mockPrefetchScenarioData.mockResolvedValue({
        success: false,
        error: "Scenario nonexistent not found",
      });

      // When: the run scenario API is called
      // Then: it returns an immediate error (not scheduled)
      await expect(caller.run({
        ...defaultInput,
        scenarioId: "nonexistent",
      })).rejects.toThrow(TRPCError);

      try {
        await caller.run({
          ...defaultInput,
          scenarioId: "nonexistent",
        });
      } catch (error) {
        // And: the error message contains "not found"
        expect(error).toBeInstanceOf(TRPCError);
        const trpcError = error as TRPCError;
        expect(trpcError.code).toBe("BAD_REQUEST");
        expect(trpcError.message).toContain("not found");
      }

      // And: scheduleScenarioRun is NOT called when validation fails
      expect(mockScheduleScenarioRun).not.toHaveBeenCalled();
    });
  });

  describe("Return immediate error when prompt not found", () => {
    /**
     * @feature specs/scenarios/simulation-runner.feature
     * @scenario Return immediate error when prompt not found
     */
    it("throws TRPCError with BAD_REQUEST when prompt does not exist", async () => {
      // Given: scenario "Test" exists, and prompt "nonexistent" does not exist
      mockPrefetchScenarioData.mockResolvedValue({
        success: false,
        error: "Prompt nonexistent not found",
      });

      // When: the run scenario API is called with prompt target
      const input = {
        ...defaultInput,
        target: { type: "prompt" as const, referenceId: "nonexistent" },
      };

      // Then: it returns an immediate error (not scheduled)
      await expect(caller.run(input)).rejects.toThrow(TRPCError);

      try {
        await caller.run(input);
      } catch (error) {
        // And: the error message contains "not found"
        expect(error).toBeInstanceOf(TRPCError);
        const trpcError = error as TRPCError;
        expect(trpcError.code).toBe("BAD_REQUEST");
        expect(trpcError.message).toContain("not found");
      }

      // And: scheduleScenarioRun is NOT called when validation fails
      expect(mockScheduleScenarioRun).not.toHaveBeenCalled();
    });
  });

  describe("Successful validation schedules the job", () => {
    it("schedules scenario run when validation passes", async () => {
      // Given: all validation passes
      mockPrefetchScenarioData.mockResolvedValue({
        success: true,
        data: {
          context: {
            projectId: "proj_123",
            scenarioId: "scen_123",
            setId: "default",
            batchRunId: "batch_test_123",
          },
          scenario: {
            id: "scen_123",
            name: "Test Scenario",
            situation: "User asks a question",
            criteria: ["Must respond politely"],
            labels: [],
          },
          adapterData: {
            type: "prompt",
            promptId: "prompt_123",
            systemPrompt: "You are helpful",
            messages: [],
          },
          modelParams: {
            api_key: "test-key",
            model: "openai/gpt-4",
          },
          nlpServiceUrl: "http://localhost:8080",
        },
        telemetry: {
          endpoint: "http://localhost:3000",
          apiKey: "test-api-key",
        },
      });

      // When: the run scenario API is called
      const result = await caller.run(defaultInput);

      // Then: the job is scheduled
      expect(mockScheduleScenarioRun).toHaveBeenCalledWith({
        projectId: "proj_123",
        scenarioId: "scen_123",
        target: { type: "prompt", referenceId: "prompt_123" },
        setId: "local-scenarios",
        batchRunId: "batch_test_123",
      });

      // And: returns the scheduled job info
      expect(result).toEqual({
        scheduled: true,
        jobId: "job_test_123",
        setId: "local-scenarios",
        batchRunId: "batch_test_123",
      });
    });
  });
});
