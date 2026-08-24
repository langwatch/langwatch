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

vi.mock("~/server/scenarios/scenario.ids", () => ({
  generateBatchRunId: vi.fn().mockReturnValue("batch_test_123"),
}));

// The run resolves the scenario's declared parameters before it queues
// anything, which is the router's only database read. Stubbed here so this
// suite stays a unit test of the router's own decisions.
async function scenariosWithoutParameters({ ids }: { ids: string[] }) {
  return ids.map((id) => ({
    id,
    name: "Test Scenario",
    situation: "User asks a question",
    criteria: ["Must respond politely"],
    parameters: null,
  }));
}

const mockGetRunConfigByIds = vi.fn<
  (params: { ids: string[]; projectId: string }) => Promise<unknown[]>
>(scenariosWithoutParameters);
vi.mock("~/server/scenarios/scenario.service", () => ({
  ScenarioService: {
    create: vi.fn().mockReturnValue({
      getRunConfigByIds: (params: { ids: string[]; projectId: string }) =>
        mockGetRunConfigByIds(params),
    }),
  },
}));

const mockQueueRun = vi.fn().mockResolvedValue(undefined);
vi.mock("~/server/app-layer/app", async () => {
  const { appPermissionsService } = await import(
    "~/test-utils/appPermissionsMock"
  );
  return {
    // Consumers that degrade without Redis read through this one.
    tryGetApp: () => null,
    getApp: vi.fn().mockReturnValue({
      permissions: appPermissionsService(),
      simulations: {
        queueRun: (...args: unknown[]) => mockQueueRun(...args),
      },
    }),
  };
});

vi.mock("@langwatch/ksuid", () => ({
  generate: vi.fn().mockReturnValue({
    toString: () => "scenariorun_test_456",
  }),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock RBAC to always allow - we're testing business logic, not permissions
vi.mock("../../../rbac", () => ({
  resolveProjectPermission: vi
    .fn()
    .mockResolvedValue({ permitted: true, organizationRole: "MEMBER" }),
}));

// Mock audit log to avoid database calls
vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

// Import mocked functions after mocking
import { prefetchScenarioData } from "~/server/scenarios/execution/data-prefetcher";
import { getOnPlatformSetId } from "~/server/scenarios/internal-set-id";
import { createInnerTRPCContext } from "../../../trpc";
import { simulationRunnerRouter } from "../simulation-runner.router";

const mockPrefetchScenarioData = vi.mocked(prefetchScenarioData);

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
    mockQueueRun.mockResolvedValue(undefined);
    // clearAllMocks keeps implementations, so a suite that gave scenarios their
    // own parameters would otherwise keep them for every suite after it.
    mockGetRunConfigByIds.mockImplementation(scenariosWithoutParameters);
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
        expect(mockQueueRun).not.toHaveBeenCalled();
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
        expect(mockQueueRun).not.toHaveBeenCalled();
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
        expect(mockQueueRun).not.toHaveBeenCalled();
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
        expect(mockQueueRun).not.toHaveBeenCalled();
      });
    });
  });

  describe("given validation passes but queueRun command fails", () => {
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
          parameters: {},
          adapterData: {
            type: "prompt",
            promptId: "prompt_123",
            systemPrompt: "You are helpful",
            messages: [],
            inputs: [],
          },
          modelParams: {
            api_key: "test-key",
            model: "openai/gpt-4",
          },
          simulatorModelParams: {
            api_key: "test-key",
            model: "openai/gpt-5-mini",
          },
          judgeModelParams: {
            api_key: "test-key",
            model: "openai/gpt-5-mini",
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

    describe("when queueRun command fails", () => {
      beforeEach(() => {
        mockQueueRun.mockRejectedValue(new Error("ClickHouse write failed"));
      });

      it("throws TRPCError with INTERNAL_SERVER_ERROR code", async () => {
        await expect(caller.run(defaultInput)).rejects.toMatchObject({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to queue scenario run",
        });
      });

      it("propagates the error as INTERNAL_SERVER_ERROR", async () => {
        await expect(caller.run(defaultInput)).rejects.toMatchObject({
          code: "INTERNAL_SERVER_ERROR",
        });
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
          parameters: {},
          adapterData: {
            type: "prompt",
            promptId: "prompt_123",
            systemPrompt: "You are helpful",
            messages: [],
            inputs: [],
          },
          modelParams: {
            api_key: "test-key",
            model: "openai/gpt-4",
          },
          simulatorModelParams: {
            api_key: "test-key",
            model: "openai/gpt-5-mini",
          },
          judgeModelParams: {
            api_key: "test-key",
            model: "openai/gpt-5-mini",
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
      it("dispatches queueRun command before scheduling", async () => {
        await caller.run(defaultInput);

        const expectedSetId = getOnPlatformSetId(defaultInput.projectId);
        expect(mockQueueRun).toHaveBeenCalledWith(
          expect.objectContaining({
            tenantId: "proj_123",
            scenarioRunId: "scenariorun_test_456",
            scenarioId: "scen_123",
            batchRunId: "batch_test_123",
            scenarioSetId: expectedSetId,
            occurredAt: expect.any(Number),
          }),
        );
      });

      it("passes the pre-generated scenarioRunId to queueRun", async () => {
        await caller.run(defaultInput);

        expect(mockQueueRun).toHaveBeenCalledWith(
          expect.objectContaining({
            scenarioRunId: "scenariorun_test_456",
          }),
        );
      });

      it("returns scenarioRunId alongside existing fields", async () => {
        const result = await caller.run(defaultInput);

        const expectedSetId = getOnPlatformSetId(defaultInput.projectId);
        expect(result).toEqual({
          scheduled: true,
          setId: expectedSetId,
          batchRunId: "batch_test_123",
          scenarioRunId: "scenariorun_test_456",
        });
      });
    });

    describe("when run is called with explicit setId", () => {
      it("preserves the user-provided set ID in queueRun", async () => {
        const inputWithSetId = {
          ...defaultInput,
          setId: "production-tests",
        };
        await caller.run(inputWithSetId);

        expect(mockQueueRun).toHaveBeenCalledWith(
          expect.objectContaining({
            scenarioSetId: "production-tests",
          }),
        );
      });

      it("dispatches queueRun with user-provided set ID", async () => {
        const inputWithSetId = {
          ...defaultInput,
          setId: "production-tests",
        };
        await caller.run(inputWithSetId);

        expect(mockQueueRun).toHaveBeenCalledWith(
          expect.objectContaining({
            scenarioSetId: "production-tests",
          }),
        );
      });

      it("returns scheduled job info with user-provided set ID", async () => {
        const inputWithSetId = {
          ...defaultInput,
          setId: "production-tests",
        };
        const result = await caller.run(inputWithSetId);

        expect(result).toEqual({
          scheduled: true,
          setId: "production-tests",
          batchRunId: "batch_test_123",
          scenarioRunId: "scenariorun_test_456",
        });
      });
    });

    describe("when the scenario declares parameters", () => {
      beforeEach(() => {
        mockGetRunConfigByIds.mockImplementation(async ({ ids }) =>
          ids.map((id) => ({
            id,
            name: "Test Scenario",
            situation: "A {{ params.account_tier }} customer asks a question",
            criteria: ["Must respond politely"],
            parameters: [
              { name: "account_tier", defaultValue: "gold" },
              { name: "region", defaultValue: "eu-central" },
            ],
          })),
        );
      });

      it("records the resolved values on the queued run's metadata", async () => {
        await caller.run({
          ...defaultInput,
          parameters: { account_tier: "platinum" },
        });

        expect(mockQueueRun).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: {
              parameters: { account_tier: "platinum", region: "eu-central" },
            },
          }),
        );
      });

      it("hands the resolved values to the prefetch that validates the run", async () => {
        await caller.run({
          ...defaultInput,
          parameters: { account_tier: "platinum" },
        });

        expect(mockPrefetchScenarioData).toHaveBeenCalledWith(
          expect.objectContaining({
            context: expect.objectContaining({
              parameters: { account_tier: "platinum", region: "eu-central" },
            }),
          }),
        );
      });

      it("rejects a name no scenario declares before anything is queued", async () => {
        await expect(
          caller.run({ ...defaultInput, parameters: { regoin: "eu-west" } }),
        ).rejects.toMatchObject({
          code: "UNPROCESSABLE_CONTENT",
          cause: { code: "scenario_parameter_unknown" },
        });

        expect(mockPrefetchScenarioData).not.toHaveBeenCalled();
        expect(mockQueueRun).not.toHaveBeenCalled();
      });
    });

    describe("when the run carries a note", () => {
      /** @scenario "The note is written under the top-level note key of the run metadata" */
      /** @scenario "A note on a single test case run is stored with that run" */
      it("writes the note under the top-level note key of the run metadata", async () => {
        await caller.run({ ...defaultInput, note: "nightly regression" });

        expect(mockQueueRun).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: { note: "nightly regression" },
          }),
        );
      });

      /** @scenario "The note is written under the top-level note key of the run metadata" */
      it("keeps the note out of the reserved langwatch namespace", async () => {
        await caller.run({ ...defaultInput, note: "nightly regression" });

        const queued = mockQueueRun.mock.calls[0]?.[0] as {
          metadata?: Record<string, unknown>;
        };
        expect(queued.metadata?.langwatch).toBeUndefined();
      });

      it("keeps the note beside the resolved parameters", async () => {
        mockGetRunConfigByIds.mockImplementation(async ({ ids }) =>
          ids.map((id) => ({
            id,
            name: "Test Scenario",
            situation: "A {{ params.account_tier }} customer asks a question",
            criteria: ["Must respond politely"],
            parameters: [{ name: "account_tier", defaultValue: "gold" }],
          })),
        );

        await caller.run({ ...defaultInput, note: "checking the gold path" });

        expect(mockQueueRun).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: {
              note: "checking the gold path",
              parameters: { account_tier: "gold" },
            },
          }),
        );
      });

      it("drops a note of only spaces", async () => {
        await caller.run({ ...defaultInput, note: "   " });

        const queued = mockQueueRun.mock.calls[0]?.[0] as {
          metadata?: Record<string, unknown>;
        };
        expect(queued.metadata).toBeUndefined();
      });

      it("rejects a note longer than the limit before anything is queued", async () => {
        await expect(
          caller.run({ ...defaultInput, note: "a".repeat(201) }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });

        expect(mockQueueRun).not.toHaveBeenCalled();
      });
    });

    describe("when the run carries no note", () => {
      /** @scenario "A run queued without a note records metadata identical to before notes existed" */
      it("records no note key at all", async () => {
        await caller.run(defaultInput);

        const queued = mockQueueRun.mock.calls[0]?.[0] as {
          metadata?: Record<string, unknown>;
        };
        expect(queued.metadata).toBeUndefined();
      });
    });
  });
});
