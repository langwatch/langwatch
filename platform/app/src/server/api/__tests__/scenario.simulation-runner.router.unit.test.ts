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

import { ScenarioApp, type ScenarioAppDependencies } from "@langwatch/scenario-server";
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrefetchScenarioData = vi.fn();
const mockResolveRunParameters = vi.fn();

vi.mock("@langwatch/scenario-contract", async (importOriginal) => ({
  ...(await importOriginal()),
  generateBatchRunId: vi.fn().mockReturnValue("batch_test_123"),
}));

/**
 * The scenario every test starts from: no declared parameters, version 1.
 *
 * The run resolves the scenario's declared parameters before it queues
 * anything, which is the router's only database read. Stubbed here so this
 * suite stays a unit test of the router's own decisions.
 *
 * Named and re-applied per test because two tests below override it in their
 * own body, and `vi.clearAllMocks()` clears recorded calls without restoring
 * an implementation — so without this the parameterised scenario leaked into
 * every later test in the file.
 */
const defaultRunConfigs = async ({
  ids,
}: {
  ids: string[];
  projectId: string;
}): Promise<ScenarioRunConfig[]> =>
  ids.map((id) => ({
    id,
    name: "Test Scenario",
    situation: "User asks a question",
    criteria: ["Must respond politely"],
    parameters: null,
    version: 1,
  }));

const mockGetRunConfigByIds =
  vi.fn<(params: { ids: string[]; projectId: string }) => Promise<ScenarioRunConfig[]>>(
    defaultRunConfigs,
  );
const mockQueueRun = vi.fn().mockResolvedValue(undefined);
vi.mock("~/server/app-layer/app", async () => {
  const { appPermissionsMock } = await import("~/test-utils/appPermissionsMock");
  const authz = appPermissionsMock();
  return {
    // Consumers that degrade without Redis read through this one.
    tryGetApp: authz.tryGetApp,
    getApp: vi.fn().mockReturnValue({
      ...authz.getApp(),
      // The run surface is one application now — the transport reads
      // `ctx.app.scenarios` for parameter resolution, prefetch AND queueing —
      // so the real `ScenarioApp` stands here over the same three service
      // doubles it used to be given side by side. It is what assembles the
      // queued run's metadata envelope, which is what the assertions below
      // are about, so faking it would leave that rule untested.
      scenarios: ScenarioApp.create({
        scenarios: {
          getRunConfigs: (params: { ids: string[]; projectId: string }) =>
            mockGetRunConfigByIds(params),
          resolveRunParameters: (...args: unknown[]) => mockResolveRunParameters(...args),
        },
        simulations: {
          queueRun: (...args: unknown[]) => mockQueueRun(...args),
        },
        scenarioExecution: {
          prefetch: (...args: unknown[]) => mockPrefetchScenarioData(...args),
        },
      } as unknown as ScenarioAppDependencies),
    }),
  };
});

vi.mock("@langwatch/ksuid", () => ({
  generate: vi.fn().mockReturnValue({
    toString: () => "scenariorun_test_456",
  }),
}));

// Partial: the packaged tRPC policy this router mounts under also reaches for
// `createWarnThrottle`, and a whole-module replacement leaves that export
// undefined, which fails the file at collection rather than in a test.
vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createLogger: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
    }),
  };
});

// Mock RBAC to always allow - we're testing business logic, not permissions.
// Partial for the same reason as the observability mock above: the policy
// chain reaches other exports of this module, and replacing it wholesale
// leaves them undefined.
vi.mock("../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../rbac")>();
  return {
    ...actual,
    resolveProjectPermission: vi
      .fn()
      .mockResolvedValue({ permitted: true, organizationRole: "MEMBER" }),
  };
});

// Mock audit log to avoid database calls
vi.mock("~/runtime/app/features/audit-log", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

import {
  getOnPlatformSetId,
  resolveRunParameters,
  type ResolveScenarioRunParametersInput,
  type ScenarioRunConfig,
  ScenarioNotFoundError,
} from "@langwatch/scenario-contract";
import { createInnerTRPCContext } from "../trpc";
import { appRouter } from "../root";

function createTestCaller() {
  const ctx = createInnerTRPCContext({
    session: {
      user: { id: "user_test_123" },
      expires: "2099-01-01",
    },
  });
  return appRouter.createCaller({
    ...ctx,
    permissionChecked: true,
  });
}

describe("scenarios.run", () => {
  const defaultInput = {
    projectId: "proj_123",
    scenarioId: "scen_123",
    target: { type: "prompt" as const, referenceId: "prompt_123" },
  };

  let caller: ReturnType<typeof createTestCaller>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRunConfigByIds.mockImplementation(defaultRunConfigs);
    mockQueueRun.mockResolvedValue(undefined);
    mockResolveRunParameters.mockImplementation(
      async (input: ResolveScenarioRunParametersInput) => {
        const scenarios = await mockGetRunConfigByIds({
          ids: [input.scenarioId],
          projectId: input.projectId,
        });
        const resolved = await resolveRunParameters({
          scenarios,
          values: input.values,
        });
        const values = resolved.get(input.scenarioId);
        if (!values) {
          throw new ScenarioNotFoundError(input.scenarioId);
        }

        const scenario = scenarios.find((candidate) => candidate.id === input.scenarioId);
        if (!scenario) {
          throw new ScenarioNotFoundError(input.scenarioId);
        }

        return { ...values, scenarioVersion: scenario.version };
      },
    );
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
        await expect(caller.scenarios.run(defaultInput)).rejects.toMatchObject({
          code: "BAD_REQUEST",
          message: "Project default model is not configured",
        });
      });

      it("does not schedule the job", async () => {
        try {
          await caller.scenarios.run(defaultInput);
        } catch {
          // Expected to throw
        }
        expect(mockQueueRun).not.toHaveBeenCalled();
      });
    });
  });

  describe("given scenario does not exist", () => {
    beforeEach(() => {
      mockResolveRunParameters.mockRejectedValue(new ScenarioNotFoundError("nonexistent"));
    });

    describe("when run is called", () => {
      it("throws TRPCError with BAD_REQUEST code", async () => {
        await expect(
          caller.scenarios.run({
            ...defaultInput,
            scenarioId: "nonexistent",
          }),
        ).rejects.toThrow(TRPCError);
      });

      it("returns error message containing not found", async () => {
        await expect(
          caller.scenarios.run({ ...defaultInput, scenarioId: "nonexistent" }),
        ).rejects.toMatchObject({
          code: "BAD_REQUEST",
          message: expect.stringContaining("not found"),
        });
      });

      it("does not schedule the job", async () => {
        try {
          await caller.scenarios.run({ ...defaultInput, scenarioId: "nonexistent" });
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
        await expect(caller.scenarios.run(input)).rejects.toThrow(TRPCError);
      });

      it("returns error message containing not found", async () => {
        await expect(caller.scenarios.run(input)).rejects.toMatchObject({
          code: "BAD_REQUEST",
          message: expect.stringContaining("not found"),
        });
      });

      it("does not schedule the job", async () => {
        try {
          await caller.scenarios.run(input);
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
        await expect(caller.scenarios.run(input)).rejects.toThrow(TRPCError);
      });

      it("returns error message containing Code agent and not found", async () => {
        await expect(caller.scenarios.run(input)).rejects.toMatchObject({
          code: "BAD_REQUEST",
          message: expect.stringMatching(/Code agent.*not found/),
        });
      });

      it("does not schedule the job", async () => {
        try {
          await caller.scenarios.run(input);
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
        await expect(caller.scenarios.run(defaultInput)).rejects.toMatchObject({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to queue scenario run",
        });
      });

      it("propagates the error as INTERNAL_SERVER_ERROR", async () => {
        await expect(caller.scenarios.run(defaultInput)).rejects.toMatchObject({
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
      /** @scenario "A single test case run goes to the project internal run set" */
      it("dispatches queueRun command before scheduling", async () => {
        await caller.scenarios.run(defaultInput);

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

      /** @scenario "A one-off batch carries the name of the test case that ran" */
      it("stamps the scenario name onto the queued run", async () => {
        await caller.scenarios.run(defaultInput);

        expect(mockQueueRun).toHaveBeenCalledWith(
          expect.objectContaining({ name: "Test Scenario" }),
        );
      });

      it("passes the pre-generated scenarioRunId to queueRun", async () => {
        await caller.scenarios.run(defaultInput);

        expect(mockQueueRun).toHaveBeenCalledWith(
          expect.objectContaining({
            scenarioRunId: "scenariorun_test_456",
          }),
        );
      });

      it("returns scenarioRunId alongside existing fields", async () => {
        const result = await caller.scenarios.run(defaultInput);

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
        await caller.scenarios.run(inputWithSetId);

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
        const result = await caller.scenarios.run(inputWithSetId);

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
            version: 5,
          })),
        );
      });

      it("records the resolved values on the queued run's metadata", async () => {
        await caller.scenarios.run({
          ...defaultInput,
          parameters: { account_tier: "platinum" },
        });

        expect(mockQueueRun).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: expect.objectContaining({
              parameters: { account_tier: "platinum", region: "eu-central" },
            }),
          }),
        );
      });

      it("hands the resolved values to the prefetch that validates the run", async () => {
        await caller.scenarios.run({
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
          caller.scenarios.run({ ...defaultInput, parameters: { regoin: "eu-west" } }),
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
        await caller.scenarios.run({ ...defaultInput, note: "nightly regression" });

        expect(mockQueueRun).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: expect.objectContaining({ note: "nightly regression" }),
          }),
        );
      });

      /** @scenario "The note is written under the top-level note key of the run metadata" */
      it("keeps the note out of the reserved langwatch namespace", async () => {
        await caller.scenarios.run({ ...defaultInput, note: "nightly regression" });

        const queued = mockQueueRun.mock.calls[0]?.[0] as {
          metadata?: Record<string, unknown>;
        };
        expect(queued.metadata?.langwatch).not.toHaveProperty("note");
      });

      it("keeps the note beside the resolved parameters", async () => {
        mockGetRunConfigByIds.mockImplementation(async ({ ids }) =>
          ids.map((id) => ({
            id,
            name: "Test Scenario",
            situation: "A {{ params.account_tier }} customer asks a question",
            criteria: ["Must respond politely"],
            parameters: [{ name: "account_tier", defaultValue: "gold" }],
            version: 5,
          })),
        );

        await caller.scenarios.run({ ...defaultInput, note: "checking the gold path" });

        expect(mockQueueRun).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: expect.objectContaining({
              note: "checking the gold path",
              parameters: { account_tier: "gold" },
            }),
          }),
        );
      });

      it("drops a note of only spaces", async () => {
        await caller.scenarios.run({ ...defaultInput, note: "   " });

        const queued = mockQueueRun.mock.calls[0]?.[0] as {
          metadata?: Record<string, unknown>;
        };
        expect(queued.metadata).not.toHaveProperty("note");
      });

      it("rejects a note longer than the limit before anything is queued", async () => {
        await expect(
          caller.scenarios.run({ ...defaultInput, note: "a".repeat(201) }),
        ).rejects.toMatchObject({
          code: "BAD_REQUEST",
        });

        expect(mockQueueRun).not.toHaveBeenCalled();
      });
    });

    describe("when the run carries no note", () => {
      /** @scenario "A run queued without a note records metadata identical to before notes existed" */
      it("records no note key at all", async () => {
        await caller.scenarios.run(defaultInput);

        const queued = mockQueueRun.mock.calls[0]?.[0] as {
          metadata?: Record<string, unknown>;
        };
        expect(queued.metadata).not.toHaveProperty("note");
        // Only the reserved namespace is recorded: the note added nothing.
        expect(queued.metadata).toEqual({
          langwatch: {
            targetReferenceId: "prompt_123",
            targetType: "prompt",
            scenarioVersion: 1,
          },
        });
      });
    });

    describe("the reserved langwatch namespace on a one-off run", () => {
      /** @scenario "A one-off run records which target it ran against" */
      /** @scenario "A one-off run of a single case records that case version" */
      it("records the target, its kind and the scenario version read at queue time", async () => {
        // A version that is not the file's default, so the assertion proves
        // the number was read off the scenario rather than defaulted.
        mockGetRunConfigByIds.mockImplementation(async ({ ids }) =>
          ids.map((id) => ({
            id,
            name: "Test Scenario",
            situation: "User asks a question",
            criteria: ["Must respond politely"],
            parameters: null,
            version: 5,
          })),
        );

        await caller.scenarios.run(defaultInput);

        expect(mockQueueRun).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: expect.objectContaining({
              langwatch: {
                targetReferenceId: "prompt_123",
                targetType: "prompt",
                scenarioVersion: 5,
              },
            }),
          }),
        );
      });
    });
  });
});
