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
import type { TraceService } from "~/server/traces/trace.service";
import type { LangEvalsClient } from "../../clients/langevals/langevals.client";
import { EvaluatorNotFoundError, TraceNotEvaluatableError } from "../errors";
import {
  type EvaluationExecutionDeps,
  EvaluationExecutionService,
  extractParentTraceForNlpgo,
  type ModelEnvResolver,
  maxCausalityDepthOfSpans,
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
  traceService?: Partial<
    Pick<TraceService, "getTracesWithSpans" | "getTracesWithSpansByThreadIds">
  >;
  modelEnvResolver?: Partial<ModelEnvResolver>;
  workflowExecutor?: Partial<WorkflowExecutor>;
  client?: Partial<LangEvalsClient>;
  trace?: Trace | undefined;
}

function createTestService(overrides: TestOverrides = {}) {
  const defaultTrace = "trace" in overrides ? overrides.trace : buildTrace();

  const mockTraceService = {
    getTracesWithSpans: vi
      .fn()
      .mockResolvedValue(defaultTrace ? [defaultTrace] : []),
    getTracesWithSpansByThreadIds: vi.fn().mockResolvedValue([]),
    ...overrides.traceService,
  } as unknown as TraceService;

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

  const mockClient: LangEvalsClient = {
    evaluate: vi.fn().mockResolvedValue({
      status: "processed",
      score: 0.95,
      passed: true,
    } satisfies SingleEvaluationResult),
    ...overrides.client,
  };

  const deps: EvaluationExecutionDeps = {
    traceService: mockTraceService,
    modelEnvResolver: mockModelEnvResolver,
    workflowExecutor: mockWorkflowExecutor,
    langevalsClient: mockClient,
  };

  const service = new EvaluationExecutionService(deps);

  return {
    service,
    mockTraceService,
    mockModelEnvResolver,
    mockWorkflowExecutor,
    mockClient,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("extractParentTraceForNlpgo", () => {
  // Returns the traceparent context (traceId + rootSpan.span_id) that
  // gets propagated as a W3C `traceparent` header from TS to nlpgo so
  // eval workflow spans land as children of the parent trace. Returning
  // undefined makes nlpgo fall back to body-supplied trace_id (no
  // parent linkage) — preferable to a fake parent_span_id that would
  // render under a non-existent span in Studio's waterfall.
  const VALID_TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
  const VALID_ROOT_SPAN_ID = "b7ad6b7169203331";

  /** @scenario extractParentTraceForNlpgo returns context for valid OTel trace */
  it("returns {traceId, parentSpanId} when trace_id is 32-hex and root span is 16-hex", () => {
    const trace = buildTrace({
      trace_id: VALID_TRACE_ID,
      spans: [
        {
          span_id: VALID_ROOT_SPAN_ID,
          parent_id: null,
          trace_id: VALID_TRACE_ID,
          type: "span",
          timestamps: { started_at: 0, finished_at: 0 },
        } as any,
      ],
    });
    expect(extractParentTraceForNlpgo(trace)).toEqual({
      traceId: VALID_TRACE_ID,
      parentSpanId: VALID_ROOT_SPAN_ID,
    });
  });

  it("lowercases the IDs so callers pass either case", () => {
    const trace = buildTrace({
      trace_id: VALID_TRACE_ID.toUpperCase(),
      spans: [
        {
          span_id: VALID_ROOT_SPAN_ID.toUpperCase(),
          parent_id: null,
          trace_id: VALID_TRACE_ID.toUpperCase(),
          type: "span",
          timestamps: { started_at: 0, finished_at: 0 },
        } as any,
      ],
    });
    const result = extractParentTraceForNlpgo(trace);
    expect(result?.traceId).toBe(VALID_TRACE_ID);
    expect(result?.parentSpanId).toBe(VALID_ROOT_SPAN_ID);
  });

  /** @scenario extractParentTraceForNlpgo returns undefined for legacy trace_id shapes */
  it("returns undefined when trace_id is the legacy trace_<nanoid> shape", () => {
    const trace = buildTrace({
      trace_id: "trace_abc123xyz",
      spans: [
        {
          span_id: VALID_ROOT_SPAN_ID,
          parent_id: null,
          trace_id: "trace_abc123xyz",
          type: "span",
          timestamps: { started_at: 0, finished_at: 0 },
        } as any,
      ],
    });
    expect(extractParentTraceForNlpgo(trace)).toBeUndefined();
  });

  it("returns undefined when there is no root span", () => {
    const trace = buildTrace({
      trace_id: VALID_TRACE_ID,
      spans: [
        {
          span_id: "0000000000000001",
          // Not a root — has a parent_id.
          parent_id: "0000000000000099",
          trace_id: VALID_TRACE_ID,
          type: "span",
          timestamps: { started_at: 0, finished_at: 0 },
        } as any,
      ],
    });
    expect(extractParentTraceForNlpgo(trace)).toBeUndefined();
  });

  it("returns undefined when trace is undefined", () => {
    expect(extractParentTraceForNlpgo(undefined)).toBeUndefined();
  });

  it("returns undefined when the root span_id is malformed (not 16-hex)", () => {
    const trace = buildTrace({
      trace_id: VALID_TRACE_ID,
      spans: [
        {
          span_id: "span_legacy_format",
          parent_id: null,
          trace_id: VALID_TRACE_ID,
          type: "span",
          timestamps: { started_at: 0, finished_at: 0 },
        } as any,
      ],
    });
    expect(extractParentTraceForNlpgo(trace)).toBeUndefined();
  });

  describe("when the trace has multiple parent-less spans", () => {
    // Broken / multi-source instrumentation can leave more than one
    // root. find() would pick whichever happened to land first in the
    // array — non-deterministic across re-runs. We pin the choice on
    // earliest started_at (with span_id tie-break) so two consecutive
    // eval runs against the same trace produce identical traceparent
    // linkage.
    const EARLIER_SPAN = "1111111111111111";
    const LATER_SPAN = "9999999999999999";

    it("picks the earliest started_at root deterministically", () => {
      const trace = buildTrace({
        trace_id: VALID_TRACE_ID,
        spans: [
          {
            span_id: LATER_SPAN,
            parent_id: null,
            trace_id: VALID_TRACE_ID,
            type: "span",
            timestamps: { started_at: 200, finished_at: 300 },
          } as any,
          {
            span_id: EARLIER_SPAN,
            parent_id: null,
            trace_id: VALID_TRACE_ID,
            type: "span",
            timestamps: { started_at: 100, finished_at: 150 },
          } as any,
        ],
      });
      expect(extractParentTraceForNlpgo(trace)?.parentSpanId).toBe(
        EARLIER_SPAN,
      );
    });

    it("falls back to span_id ordering when started_at ties", () => {
      const trace = buildTrace({
        trace_id: VALID_TRACE_ID,
        spans: [
          {
            span_id: LATER_SPAN,
            parent_id: null,
            trace_id: VALID_TRACE_ID,
            type: "span",
            timestamps: { started_at: 100, finished_at: 150 },
          } as any,
          {
            span_id: EARLIER_SPAN,
            parent_id: null,
            trace_id: VALID_TRACE_ID,
            type: "span",
            timestamps: { started_at: 100, finished_at: 150 },
          } as any,
        ],
      });
      expect(extractParentTraceForNlpgo(trace)?.parentSpanId).toBe(
        EARLIER_SPAN,
      );
    });
  });
});

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
            error: {
              has_error: true,
              message: "something broke",
              stacktrace: [],
            },
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
          undefined,
          expect.any(Number),
          // parentTrace: defaultTrace's trace_id is "trace-1" (not
          // 32-hex), so extractParentTraceForNlpgo returns undefined.
          // Adapter-level OTel trace_ids would set this to a real
          // {traceId, parentSpanId} — separately covered by
          // extractParentTraceForNlpgo's own tests.
          undefined,
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

    describe("given thread-level evaluation", () => {
      const threadTrace = buildTrace({
        metadata: { thread_id: "thread-1" },
      });

      describe("when level param is 'thread'", () => {
        it("calls traceService.getTracesWithSpansByThreadIds", async () => {
          const { service, mockTraceService } = createTestService({
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

          expect(
            mockTraceService.getTracesWithSpansByThreadIds,
          ).toHaveBeenCalledWith(
            "proj-1",
            ["thread-1"],
            expect.objectContaining({
              canSeeCosts: true,
              canSeeCapturedInput: true,
              canSeeCapturedOutput: true,
            }),
            { full: true },
          );
        });

        /** @scenario a thread-based monitor still runs for a trace with a thread_id */
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
        /** @scenario a thread-based monitor skips a trace without a thread_id */
        it("returns skipped without calling the evaluator", async () => {
          const { service, mockTraceService, mockClient } = createTestService({
            trace: buildTrace({ metadata: {} }),
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

          expect(result.status).toBe("skipped");
          expect(result.details).toContain("thread_id");
          // short-circuits before building thread data or calling the evaluator
          expect(
            mockTraceService.getTracesWithSpansByThreadIds,
          ).not.toHaveBeenCalled();
          expect(mockClient.evaluate).not.toHaveBeenCalled();
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

describe("maxCausalityDepthOfSpans", () => {
  it("returns 0 for empty / null / undefined spans", () => {
    expect(maxCausalityDepthOfSpans([])).toBe(0);
    expect(maxCausalityDepthOfSpans(undefined)).toBe(0);
    expect(maxCausalityDepthOfSpans(null)).toBe(0);
  });

  it("returns 0 when no span has the attribute", () => {
    expect(
      maxCausalityDepthOfSpans([
        { attributes: { "service.name": "x" } },
        { attributes: null },
      ]),
    ).toBe(0);
  });

  it("returns the max numeric depth across spans", () => {
    expect(
      maxCausalityDepthOfSpans([
        { attributes: { "langwatch.causality_depth": 0 } },
        { attributes: { "langwatch.causality_depth": 2 } },
        { attributes: { "langwatch.causality_depth": 1 } },
      ]),
    ).toBe(2);
  });

  it("parses string-encoded depth values", () => {
    expect(
      maxCausalityDepthOfSpans([
        { attributes: { "langwatch.causality_depth": "1" } },
        { attributes: { "langwatch.causality_depth": "3" } },
      ]),
    ).toBe(3);
  });

  it("ignores malformed values without crashing", () => {
    expect(
      maxCausalityDepthOfSpans([
        { attributes: { "langwatch.causality_depth": "not-a-number" } },
        { attributes: { "langwatch.causality_depth": NaN } },
        { attributes: { "langwatch.causality_depth": 2 } },
      ]),
    ).toBe(2);
  });

  // Real production path: spans come from mapNormalizedSpanToSpan which
  // unflattens OTLP dot-notation into nested objects under params. The
  // old helper signature only inspected `attributes` and silently
  // returned 0 for production-shaped spans.
  it("reads depth from unflattened params.langwatch.causality_depth (real Span shape)", () => {
    expect(
      maxCausalityDepthOfSpans([
        { params: { langwatch: { causality_depth: 1 } } },
        { params: { langwatch: { causality_depth: 3 } } },
        { params: { service: { name: "x" } } },
      ]),
    ).toBe(3);
  });

  it("falls back to dot-notation key when nested ns is absent", () => {
    expect(
      maxCausalityDepthOfSpans([
        { params: { "langwatch.causality_depth": "2" } },
      ]),
    ).toBe(2);
  });
});
