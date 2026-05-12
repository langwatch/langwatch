/**
 * @vitest-environment node
 *
 * Integration tests for Azure Safety BYOK credential flow through
 * EvaluationExecutionService + createDefaultModelEnvResolver.
 *
 * Covers @integration scenarios from specs/evaluators/azure-safety-byok-gating.feature:
 * - "Configured Azure provider passes keys to langevals at runtime"
 * - "Runtime skip ignores process.env for Azure evaluators"
 *
 * Strategy: use the real `createDefaultModelEnvResolver()` paired with a mocked
 * `getProjectModelProviders` so we exercise the actual resolver logic end-to-end
 * without hitting Prisma. LangEvals client is mocked to capture the env payload.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SingleEvaluationResult } from "~/server/evaluations/evaluators.generated";
import type { Trace } from "~/server/tracer/types";
import type { LangEvalsClient } from "../../clients/langevals/langevals.client";
import type { TraceService } from "~/server/traces/trace.service";

const { getProjectModelProvidersMock } = vi.hoisted(() => ({
  getProjectModelProvidersMock: vi.fn(),
}));

vi.mock("~/server/api/routers/modelProviders.utils", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("~/server/api/routers/modelProviders.utils")
    >();
  return {
    ...actual,
    getProjectModelProviders: getProjectModelProvidersMock,
  };
});

import { createDefaultModelEnvResolver } from "../evaluation-execution.factories";
import {
  EvaluationExecutionService,
  type EvaluationExecutionDeps,
  type WorkflowExecutor,
} from "../evaluation-execution.service";

const AZURE_EVALUATOR_TYPE = "azure/content_safety";

function buildTrace(overrides?: Partial<Trace>): Trace {
  return {
    trace_id: "trace-azure-1",
    project_id: "proj-azure-1",
    input: { value: "please moderate this" },
    output: { value: "safe response" },
    timestamps: { started_at: Date.now(), inserted_at: Date.now() },
    spans: [],
    ...overrides,
  } as Trace;
}

function createService(overrides: {
  clientEvaluate?: (...args: unknown[]) => Promise<SingleEvaluationResult>;
  trace?: Trace;
} = {}) {
  const trace = overrides.trace ?? buildTrace();

  const mockTraceService = {
    getTracesWithSpans: vi.fn().mockResolvedValue([trace]),
    getTracesWithSpansByThreadIds: vi.fn().mockResolvedValue([]),
  } as unknown as TraceService;

  const mockWorkflowExecutor: WorkflowExecutor = {
    runEvaluationWorkflow: vi.fn(),
  };

  const evaluate =
    overrides.clientEvaluate ??
    vi.fn().mockResolvedValue({
      status: "processed",
      score: 0.1,
      passed: true,
    } satisfies SingleEvaluationResult);

  const mockClient: LangEvalsClient = {
    evaluate,
  };

  const deps: EvaluationExecutionDeps = {
    traceService: mockTraceService,
    modelEnvResolver: createDefaultModelEnvResolver(),
    workflowExecutor: mockWorkflowExecutor,
    langevalsClient: mockClient,
  };

  const service = new EvaluationExecutionService(deps);

  return { service, mockClient, evaluate };
}

describe("EvaluationExecutionService — Azure Safety BYOK env flow", () => {
  const defaultParams = {
    projectId: "proj-azure-1",
    traceId: "trace-azure-1",
    evaluatorType: AZURE_EVALUATOR_TYPE,
    settings: null as Record<string, unknown> | null,
    mappings: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AZURE_CONTENT_SAFETY_ENDPOINT = "https://shared.example.com/";
    process.env.AZURE_CONTENT_SAFETY_KEY = "shared-key";
  });

  describe("given the project has azure_safety configured with valid keys", () => {
    beforeEach(() => {
      getProjectModelProvidersMock.mockResolvedValue({
        azure_safety: {
          provider: "azure_safety",
          enabled: true,
          customKeys: {
            AZURE_CONTENT_SAFETY_ENDPOINT:
              "https://byok-account.cognitiveservices.azure.com/",
            AZURE_CONTENT_SAFETY_KEY: "byok-subscription-key",
          },
        },
      });
    });

    describe("when executeForTrace runs an azure evaluator", () => {
      it("calls langevalsClient.evaluate with env from the project config", async () => {
        const { service, evaluate } = createService();

        await service.executeForTrace(defaultParams);

        expect(evaluate).toHaveBeenCalledTimes(1);
        expect(evaluate).toHaveBeenCalledWith(
          expect.objectContaining({
            evaluatorType: AZURE_EVALUATOR_TYPE,
            env: {
              AZURE_CONTENT_SAFETY_ENDPOINT:
                "https://byok-account.cognitiveservices.azure.com/",
              AZURE_CONTENT_SAFETY_KEY: "byok-subscription-key",
            },
          }),
        );
      });

      it("does not leak shared process.env credentials", async () => {
        const { service, evaluate } = createService();

        await service.executeForTrace(defaultParams);

        const call = (evaluate as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
        expect(call?.env?.AZURE_CONTENT_SAFETY_ENDPOINT).not.toBe(
          "https://shared.example.com/",
        );
        expect(call?.env?.AZURE_CONTENT_SAFETY_KEY).not.toBe("shared-key");
      });
    });
  });

  describe("given the project has NO azure_safety provider configured", () => {
    beforeEach(() => {
      getProjectModelProvidersMock.mockResolvedValue({
        openai: {
          provider: "openai",
          enabled: true,
          customKeys: { OPENAI_API_KEY: "sk-x" },
        },
      });
    });

    describe("when executeForTrace runs an azure evaluator", () => {
      it("calls langevalsClient.evaluate with an empty env object", async () => {
        const { service, evaluate } = createService();

        await service.executeForTrace(defaultParams);

        expect(evaluate).toHaveBeenCalledTimes(1);
        const call = (evaluate as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
        expect(call?.env).toEqual({});
      });

      it("does not pass process.env Azure credentials through", async () => {
        const { service, evaluate } = createService();

        await service.executeForTrace(defaultParams);

        const call = (evaluate as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
        expect(call?.env?.AZURE_CONTENT_SAFETY_KEY).toBeUndefined();
        expect(call?.env?.AZURE_CONTENT_SAFETY_ENDPOINT).toBeUndefined();
      });
    });
  });

  describe("given the azure_safety provider is disabled", () => {
    beforeEach(() => {
      getProjectModelProvidersMock.mockResolvedValue({
        azure_safety: {
          provider: "azure_safety",
          enabled: false,
          customKeys: {
            AZURE_CONTENT_SAFETY_ENDPOINT:
              "https://byok-account.cognitiveservices.azure.com/",
            AZURE_CONTENT_SAFETY_KEY: "byok-subscription-key",
          },
        },
      });
    });

    describe("when executeForTrace runs an azure evaluator", () => {
      it("passes an empty env (the command handler will skip)", async () => {
        const { service, evaluate } = createService();

        await service.executeForTrace(defaultParams);

        const call = (evaluate as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
        expect(call?.env).toEqual({});
      });
    });
  });

  describe("given a non-azure evaluator", () => {
    beforeEach(() => {
      getProjectModelProvidersMock.mockResolvedValue({});
      process.env.CUSTOM_LLM_MODERATION_KEY = "some-process-env-key";
    });

    describe("when executeForTrace runs openai/moderation", () => {
      it("keeps reading envVars from process.env as before", async () => {
        const { service, evaluate } = createService();

        await service.executeForTrace({
          ...defaultParams,
          evaluatorType: "openai/moderation",
        });

        // openai/moderation declares no envVars, so env remains empty
        // but crucially the azure gate does NOT kick in.
        expect(evaluate).toHaveBeenCalledTimes(1);
      });
    });
  });
});
