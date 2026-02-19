/**
 * @vitest-environment node
 *
 * Unit tests for EvaluationExecutionService.
 *
 * All I/O deps are injected via constructor — zero vi.mock calls.
 * Uses real AVAILABLE_EVALUATORS registry (openai/moderation) to avoid
 * module mock issues with vmThreads + fsModuleCache.
 */

import { describe, expect, it, vi } from "vitest";
import type { SingleEvaluationResult } from "~/server/evaluations/evaluators.generated";
import type { Trace } from "~/server/tracer/types";
import type { LangEvalsClient } from "../../clients/langevals/langevals.client";
import {
  CostLimitExceededError,
  EvaluatorConfigError,
  EvaluatorNotFoundError,
  TraceNotEvaluatableError,
} from "../errors";
import {
  EvaluationExecutionService,
  type CostChecker,
  type EvaluationExecutionDeps,
  type ModelEnvResolver,
  type ProjectFetcher,
  type TraceFetcher,
  type WorkflowExecutor,
} from "../evaluation-execution.service";

// Uses a real evaluator from AVAILABLE_EVALUATORS — no vi.mock needed.
// openai/moderation: requiredFields=[], optionalFields=["input","output"], envVars=[]
const BUILTIN_EVALUATOR = "openai/moderation";

// ---------------------------------------------------------------------------
// Test data builders
// ---------------------------------------------------------------------------

function buildTrace(overrides?: Partial<Trace>): Trace {
  return {
    trace_id: "trace-1",
    project_id: "proj-1",
    input: { value: "hello" },
    output: { value: "world" },
    timestamps: { started_at: Date.now(), inserted_at: Date.now() },
    spans: [],
    ...overrides,
  } as Trace;
}

// ---------------------------------------------------------------------------
// Test service factory
// ---------------------------------------------------------------------------

interface TestOverrides {
  traceFetcher?: Partial<TraceFetcher>;
  costChecker?: Partial<CostChecker>;
  modelEnvResolver?: Partial<ModelEnvResolver>;
  workflowExecutor?: Partial<WorkflowExecutor>;
  projectFetcher?: Partial<ProjectFetcher>;
  client?: Partial<LangEvalsClient>;
  trace?: Trace | undefined;
}

function createTestService(overrides: TestOverrides = {}) {
  const defaultTrace = "trace" in overrides ? overrides.trace : buildTrace();

  const mockTraceFetcher: TraceFetcher = {
    getTraceById: vi.fn().mockResolvedValue(defaultTrace),
    getTracesGroupedByThreadId: vi.fn().mockResolvedValue([]),
    ...overrides.traceFetcher,
  };

  const mockCostChecker: CostChecker = {
    maxMonthlyUsageLimit: vi.fn().mockResolvedValue(Infinity),
    getCurrentMonthCost: vi.fn().mockResolvedValue(0),
    ...overrides.costChecker,
  };

  const mockModelEnvResolver: ModelEnvResolver = {
    resolveForEvaluator: vi.fn().mockResolvedValue({}),
    ...overrides.modelEnvResolver,
  };

  const mockWorkflowExecutor: WorkflowExecutor = {
    runEvaluationWorkflow: vi.fn().mockResolvedValue({
      result: { status: "processed", score: 1 },
      status: "success",
    }),
    ...overrides.workflowExecutor,
  };

  const mockProjectFetcher: ProjectFetcher = {
    getProjectWithTeam: vi.fn().mockResolvedValue({
      id: "proj-1",
      team: { organizationId: "org-1" },
    }),
    ...overrides.projectFetcher,
  };

  const mockClient: LangEvalsClient = {
    evaluate: vi.fn().mockResolvedValue({
      status: "processed",
      score: 0.95,
      passed: true,
    } satisfies SingleEvaluationResult),
    ...overrides.client,
  };

  const deps: EvaluationExecutionDeps = {
    traceFetcher: mockTraceFetcher,
    costChecker: mockCostChecker,
    modelEnvResolver: mockModelEnvResolver,
    workflowExecutor: mockWorkflowExecutor,
    projectFetcher: mockProjectFetcher,
  };

  const service = new EvaluationExecutionService(mockClient, deps);

  return {
    service,
    mockTraceFetcher,
    mockCostChecker,
    mockModelEnvResolver,
    mockWorkflowExecutor,
    mockProjectFetcher,
    mockClient,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EvaluationExecutionService", () => {
  describe("executeForTrace()", () => {
    const defaultParams = {
      projectId: "proj-1",
      traceId: "trace-1",
      evaluatorType: BUILTIN_EVALUATOR,
      settings: null as Record<string, unknown> | null,
      mappings: null,
    };

    describe("when trace is not found", () => {
      it("throws TraceNotEvaluatableError", async () => {
        const { service } = createTestService({ trace: undefined });

        await expect(service.executeForTrace(defaultParams)).rejects.toThrow(
          TraceNotEvaluatableError,
        );
      });
    });

    describe("when trace has error and no input/output", () => {
      it("returns skipped status", async () => {
        const { service } = createTestService({
          trace: buildTrace({
            error: { has_error: true, message: "something broke", stacktrace: [] },
            input: undefined,
            output: undefined,
          }),
        });

        const result = await service.executeForTrace(defaultParams);

        expect(result.status).toBe("skipped");
        expect(result.details).toBe("Cannot evaluate trace with errors");
      });
    });

    describe("given a valid trace with default mappings", () => {
      describe("when evaluator is a built-in type", () => {
        it("calls langevalsClient.evaluate with mapped data", async () => {
          const { service, mockClient } = createTestService();

          await service.executeForTrace(defaultParams);

          expect(mockClient.evaluate).toHaveBeenCalledWith(
            expect.objectContaining({
              evaluatorType: BUILTIN_EVALUATOR,
            }),
          );
        });

        it("returns processed result with score", async () => {
          const { service } = createTestService();

          const result = await service.executeForTrace(defaultParams);

          expect(result.status).toBe("processed");
          expect(result.score).toBe(0.95);
          expect(result.passed).toBe(true);
        });

        it("passes resolved model env to langevalsClient", async () => {
          const envVars = { X_LITELLM_model: "openai/gpt-4" };
          const { service, mockClient } = createTestService({
            modelEnvResolver: {
              resolveForEvaluator: vi.fn().mockResolvedValue(envVars),
            },
          });

          await service.executeForTrace({
            ...defaultParams,
            settings: { model: "openai/gpt-4" },
          });

          expect(mockClient.evaluate).toHaveBeenCalledWith(
            expect.objectContaining({ env: envVars }),
          );
        });
      });

      describe("when evaluator type is not in AVAILABLE_EVALUATORS", () => {
        it("throws EvaluatorNotFoundError", async () => {
          const { service } = createTestService();

          await expect(
            service.executeForTrace({
              ...defaultParams,
              evaluatorType: "nonexistent/evaluator",
            }),
          ).rejects.toThrow(EvaluatorNotFoundError);
        });
      });
    });

    describe("given a custom/workflow evaluator type", () => {
      it("delegates to workflowExecutor", async () => {
        const { service, mockWorkflowExecutor } = createTestService();

        await service.executeForTrace({
          ...defaultParams,
          evaluatorType: "custom/my-workflow",
        });

        expect(mockWorkflowExecutor.runEvaluationWorkflow).toHaveBeenCalledWith(
          "my-workflow",
          "proj-1",
          expect.objectContaining({
            trace_id: "trace-1",
            do_not_trace: true,
          }),
        );
      });

      it("returns processed status on workflow success", async () => {
        const { service } = createTestService({
          workflowExecutor: {
            runEvaluationWorkflow: vi.fn().mockResolvedValue({
              result: { score: 0.8 },
              status: "success",
            }),
          },
        });

        const result = await service.executeForTrace({
          ...defaultParams,
          evaluatorType: "custom/my-workflow",
        });

        expect(result.status).toBe("processed");
      });

      it("returns error status on workflow failure", async () => {
        const { service } = createTestService({
          workflowExecutor: {
            runEvaluationWorkflow: vi.fn().mockResolvedValue({
              result: { details: "workflow failed" },
              status: "failure",
            }),
          },
        });

        const result = await service.executeForTrace({
          ...defaultParams,
          evaluatorType: "custom/my-workflow",
        });

        expect(result.status).toBe("error");
      });
    });

    describe("when cost limit is exceeded", () => {
      it("throws CostLimitExceededError", async () => {
        const { service } = createTestService({
          costChecker: {
            maxMonthlyUsageLimit: vi.fn().mockResolvedValue(100),
            getCurrentMonthCost: vi.fn().mockResolvedValue(100),
          },
        });

        await expect(service.executeForTrace(defaultParams)).rejects.toThrow(
          CostLimitExceededError,
        );
      });
    });

    describe("when project is not found", () => {
      it("throws EvaluatorConfigError", async () => {
        const { service } = createTestService({
          projectFetcher: {
            getProjectWithTeam: vi.fn().mockResolvedValue(null),
          },
        });

        await expect(service.executeForTrace(defaultParams)).rejects.toThrow(
          EvaluatorConfigError,
        );
      });
    });

    describe("given thread-level evaluation", () => {
      const threadTrace = buildTrace({
        metadata: { thread_id: "thread-1" },
      });

      describe("when level param is 'thread'", () => {
        it("calls traceFetcher.getTracesGroupedByThreadId", async () => {
          const { service, mockTraceFetcher } = createTestService({
            trace: threadTrace,
          });

          await service.executeForTrace({
            ...defaultParams,
            evaluatorType: "custom/thread-eval",
            level: "thread",
            mappings: {
              mapping: {
                conversation: { source: "formatted_traces", type: "thread" },
              },
            } as any,
          });

          expect(mockTraceFetcher.getTracesGroupedByThreadId).toHaveBeenCalledWith({
            projectId: "proj-1",
            threadId: "thread-1",
          });
        });

        it("includes evaluationThreadId in result", async () => {
          const { service } = createTestService({
            trace: threadTrace,
          });

          const result = await service.executeForTrace({
            ...defaultParams,
            evaluatorType: "custom/thread-eval",
            level: "thread",
            mappings: {
              mapping: {
                conversation: { source: "formatted_traces", type: "thread" },
              },
            } as any,
          });

          expect(result.evaluationThreadId).toBe("thread-1");
        });
      });

      describe("when trace has no thread_id", () => {
        it("throws EvaluatorConfigError", async () => {
          const { service } = createTestService({
            trace: buildTrace({ metadata: {} }),
          });

          await expect(
            service.executeForTrace({
              ...defaultParams,
              evaluatorType: "custom/thread-eval",
              level: "thread",
              mappings: {
                mapping: {
                  conversation: { source: "formatted_traces", type: "thread" },
                },
              } as any,
            }),
          ).rejects.toThrow(EvaluatorConfigError);
        });
      });
    });

    describe("when settings is a non-object primitive", () => {
      it("normalizes settings to undefined", async () => {
        const { service, mockClient } = createTestService();

        await service.executeForTrace({
          ...defaultParams,
          settings: "not-an-object" as any,
        });

        expect(mockClient.evaluate).toHaveBeenCalledWith(
          expect.objectContaining({
            settings: {},
          }),
        );
      });
    });
  });
});
