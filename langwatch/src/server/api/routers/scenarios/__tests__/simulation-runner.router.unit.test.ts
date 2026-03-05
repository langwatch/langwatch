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
  createDataPrefetcherDependencies: vi.fn().mockReturnValue({}),
  prefetchScenarioData: vi.fn(),
}));

vi.mock("~/server/scenarios/scenario.queue", () => ({
  generateBatchRunId: vi.fn().mockReturnValue("batch_test_123"),
  scheduleScenarioRun: vi.fn().mockResolvedValue({ id: "job_test_123" }),
}));

vi.mock("~/utils/logger/server", () => ({
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

// Mock audit log to avoid database calls
vi.mock("~/server/auditLog", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

// Import mocked functions after mocking
import { prefetchScenarioData } from "~/server/scenarios/execution/data-prefetcher";
import { getOnPlatformSetId } from "~/server/scenarios/internal-set-id";
import { scheduleScenarioRun } from "~/server/scenarios/scenario.queue";
import { simulationRunnerRouter } from "../simulation-runner.router";
import { createInnerTRPCContext } from "../../../trpc";

const mockPrefetchScenarioData = vi.mocked(prefetchScenarioData);
const mockScheduleScenarioRun = vi.mocked(scheduleScenarioRun);

function createTestCaller() {
  const ctx = createInnerTRPCContext({
    session: {
      user: { id: "user_test_123" },
      expires: "2099-01-01",
    } as any,
  });
  return simulationRunnerRouter.createCaller({
    ...ctx,
    permissionChecked: true,
  });
}

describe("simulationRunnerRouter.run", () => {
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

  describe("given project has no default model configured", () => {
    beforeEach(() => {
      mockPrefetchScenarioData.mockResolvedValue({
        success: false,
        error: "Project default model is not configured",
      });
    });

    describe("when run is called", () => {
      it("throws TRPCError with BAD_REQUEST code and missing model message", async () => {
        await expect(caller.run(defaultInput)).rejects.toMatchObject({
          code: "BAD_REQUEST",
          message: "Project default model is not configured",
        });
      });

      it("does not schedule the job", async () => {
        try {
          await caller.run(defaultInput);
        } catch {
          // Expected to throw
        }
        expect(mockScheduleScenarioRun).not.toHaveBeenCalled();
      });
    });
  });

  describe("given scenario does not exist", () => {
    beforeEach(() => {
      mockPrefetchScenarioData.mockResolvedValue({
        success: false,
        error: "Scenario nonexistent not found",
      });
    });

    describe("when run is called", () => {
      it("throws TRPCError with BAD_REQUEST code", async () => {
        await expect(
          caller.run({
            ...defaultInput,
            scenarioId: "nonexistent",
          }),
        ).rejects.toThrow(TRPCError);
      });

      it("returns error message containing not found", async () => {
        await expect(
          caller.run({ ...defaultInput, scenarioId: "nonexistent" }),
        ).rejects.toMatchObject({
          code: "BAD_REQUEST",
          message: expect.stringContaining("not found"),
        });
      });

      it("does not schedule the job", async () => {
        try {
          await caller.run({ ...defaultInput, scenarioId: "nonexistent" });
        } catch {
          // Expected to throw
        }
        expect(mockScheduleScenarioRun).not.toHaveBeenCalled();
      });
    });
  });

  describe("given prompt does not exist", () => {
    beforeEach(() => {
      mockPrefetchScenarioData.mockResolvedValue({
        success: false,
        error: "Prompt nonexistent not found",
      });
    });

    describe("when run is called with prompt target", () => {
      const input = {
        ...defaultInput,
        target: { type: "prompt" as const, referenceId: "nonexistent" },
      };

      it("throws TRPCError with BAD_REQUEST code", async () => {
        await expect(caller.run(input)).rejects.toThrow(TRPCError);
      });

      it("returns error message containing not found", async () => {
        await expect(caller.run(input)).rejects.toMatchObject({
          code: "BAD_REQUEST",
          message: expect.stringContaining("not found"),
        });
      });

      it("does not schedule the job", async () => {
        try {
          await caller.run(input);
        } catch {
          // Expected to throw
        }
        expect(mockScheduleScenarioRun).not.toHaveBeenCalled();
      });
    });
  });

  describe("given code agent does not exist", () => {
    beforeEach(() => {
      mockPrefetchScenarioData.mockResolvedValue({
        success: false,
        error: "Code agent nonexistent not found",
      });
    });

    describe("when run is called with code agent target", () => {
      const input = {
        ...defaultInput,
        target: { type: "code" as const, referenceId: "nonexistent" },
      };

      it("throws TRPCError with BAD_REQUEST code", async () => {
        await expect(caller.run(input)).rejects.toThrow(TRPCError);
      });

      it("returns error message containing Code agent and not found", async () => {
        await expect(caller.run(input)).rejects.toMatchObject({
          code: "BAD_REQUEST",
          message: expect.stringMatching(/Code agent.*not found/),
        });
      });

      it("does not schedule the job", async () => {
        try {
          await caller.run(input);
        } catch {
          // Expected to throw
        }
        expect(mockScheduleScenarioRun).not.toHaveBeenCalled();
      });
    });
  });

  describe("given all validation passes", () => {
    beforeEach(() => {
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
          target: { type: "prompt", referenceId: "prompt_123" },
        },
        telemetry: {
          endpoint: "http://localhost:3000",
          apiKey: "test-api-key",
        },
      });
    });

    describe("when run is called without explicit setId", () => {
      it("schedules the scenario run with internal on-platform set ID", async () => {
        await caller.run(defaultInput);

        const expectedSetId = getOnPlatformSetId(defaultInput.projectId);
        expect(mockScheduleScenarioRun).toHaveBeenCalledWith({
          projectId: "proj_123",
          scenarioId: "scen_123",
          target: { type: "prompt", referenceId: "prompt_123" },
          setId: expectedSetId,
          batchRunId: "batch_test_123",
          index: 0,
        });
      });

      it("returns scheduled job info with internal set ID", async () => {
        const result = await caller.run(defaultInput);

        const expectedSetId = getOnPlatformSetId(defaultInput.projectId);
        expect(result).toEqual({
          scheduled: true,
          jobId: "job_test_123",
          setId: expectedSetId,
          batchRunId: "batch_test_123",
        });
      });
    });

    describe("when run is called with explicit setId", () => {
      it("preserves the user-provided set ID", async () => {
        const inputWithSetId = {
          ...defaultInput,
          setId: "production-tests",
        };
        await caller.run(inputWithSetId);

        expect(mockScheduleScenarioRun).toHaveBeenCalledWith({
          projectId: "proj_123",
          scenarioId: "scen_123",
          target: { type: "prompt", referenceId: "prompt_123" },
          setId: "production-tests",
          batchRunId: "batch_test_123",
          index: 0,
        });
      });

      it("returns scheduled job info with user-provided set ID", async () => {
        const inputWithSetId = {
          ...defaultInput,
          setId: "production-tests",
        };
        const result = await caller.run(inputWithSetId);

        expect(result).toEqual({
          scheduled: true,
          jobId: "job_test_123",
          setId: "production-tests",
          batchRunId: "batch_test_123",
        });
      });
    });
  });
});
