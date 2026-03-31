/**
 * @vitest-environment node
 *
 * Integration tests for thread variables in trace-level evaluator input mapping.
 * Feature: specs/features/evaluations-v3/thread-variables-in-trace-evaluator.feature
 *
 * Tests the backend resolution of mixed trace + thread source mappings.
 * All I/O deps are injected via constructor — zero vi.mock calls.
 */
import { describe, expect, it, vi } from "vitest";
import type { SingleEvaluationResult } from "~/server/evaluations/evaluators.generated";
import type { Trace } from "~/server/tracer/types";
import type { LangEvalsClient } from "../../clients/langevals/langevals.client";
import {
  EvaluationExecutionService,
  type EvaluationExecutionDeps,
  type ModelEnvResolver,
  type WorkflowExecutor,
} from "../evaluation-execution.service";
import type { TraceService } from "~/server/traces/trace.service";
import type { MappingState } from "~/server/tracer/tracesMapping";

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
  };

  const mockWorkflowExecutor: WorkflowExecutor = {
    runEvaluationWorkflow: vi.fn().mockResolvedValue({
      result: { status: "processed", score: 1 },
      status: "success",
    }),
  };

  const mockClient: LangEvalsClient = {
    evaluate: vi.fn().mockResolvedValue({
      status: "processed",
      score: 0.95,
      passed: true,
    } satisfies SingleEvaluationResult),
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
    mockWorkflowExecutor,
    mockClient,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Feature: Thread variables available in trace-level evaluator input mapping", () => {
  // -------------------------------------------------------------------------
  // @integration Scenario: Trace-level evaluation resolves a thread source mapping
  // -------------------------------------------------------------------------
  describe("buildDataForEvaluation (via executeForTrace)", () => {
    describe("given a trace-level evaluator with an input mapped to 'thread.traces'", () => {
      const threadTraces = [
        buildTrace({ trace_id: "t1", metadata: { thread_id: "abc" } }),
        buildTrace({
          trace_id: "t2",
          input: { value: "second" },
          output: { value: "reply" },
          metadata: { thread_id: "abc" },
        }),
      ];

      describe("when buildDataForEvaluation runs for a trace with thread_id 'abc'", () => {
        it("fetches all traces in thread 'abc' and the evaluator input contains the thread traces data", async () => {
          const trace = buildTrace({ metadata: { thread_id: "abc" } });
          const { service, mockTraceService } = createTestService({
            trace,
            traceService: {
              getTracesWithSpansByThreadIds: vi
                .fn()
                .mockResolvedValue(threadTraces),
            },
          });

          const mappings: MappingState = {
            mapping: {
              conversation: {
                type: "thread",
                source: "traces",
                selectedFields: ["input", "output"],
              },
            },
            expansions: [],
          };

          const result = await service.executeForTrace({
            projectId: "proj-1",
            traceId: "trace-1",
            evaluatorType: "custom/my-eval",
            settings: null,
            mappings,
            level: "trace",
          });

          // Should fetch thread traces
          expect(
            mockTraceService.getTracesWithSpansByThreadIds,
          ).toHaveBeenCalledWith(
            "proj-1",
            ["abc"],
            expect.objectContaining({ canSeeCapturedInput: true }),
          );

          // The conversation field should contain thread traces data
          const inputs = result.inputs as Record<string, unknown>;
          expect(inputs.conversation).toBeDefined();
          expect(Array.isArray(inputs.conversation)).toBe(true);
          expect((inputs.conversation as any[]).length).toBe(2);
        });
      });
    });
  });

  // -------------------------------------------------------------------------
  // @integration Scenario: Trace-level evaluation resolves mixed trace and thread source mappings
  // -------------------------------------------------------------------------
  describe("given a trace-level evaluator with mixed trace and thread mappings", () => {
    describe("when buildDataForEvaluation runs for a trace with thread_id 'abc'", () => {
      it("resolves 'input' from trace and 'conversation' from thread formatted_traces", async () => {
        const trace = buildTrace({
          input: { value: "user message" },
          metadata: { thread_id: "abc" },
          spans: [
            {
              span_id: "s1",
              trace_id: "trace-1",
              type: "llm",
              name: "gpt-4",
              timestamps: {
                started_at: Date.now(),
                finished_at: Date.now() + 1000,
              },
              input: { type: "text", value: "hello" },
              output: { type: "text", value: "world" },
              error: null,
              metrics: null,
              params: null,
            } as any,
          ],
        });

        const threadTraces = [
          buildTrace({
            trace_id: "t1",
            metadata: { thread_id: "abc" },
            spans: [
              {
                span_id: "s-t1",
                trace_id: "t1",
                type: "llm",
                name: "gpt-4",
                timestamps: {
                  started_at: Date.now(),
                  finished_at: Date.now() + 1000,
                },
                input: { type: "text", value: "first" },
                output: { type: "text", value: "response" },
                error: null,
                metrics: null,
                params: null,
              } as any,
            ],
          }),
        ];

        const { service } = createTestService({
          trace,
          traceService: {
            getTracesWithSpansByThreadIds: vi
              .fn()
              .mockResolvedValue(threadTraces),
          },
        });

        const mappings: MappingState = {
          mapping: {
            input: { source: "input" },
            conversation: {
              type: "thread",
              source: "formatted_traces",
            },
          },
          expansions: [],
        };

        const result = await service.executeForTrace({
          projectId: "proj-1",
          traceId: "trace-1",
          evaluatorType: "custom/my-eval",
          settings: null,
          mappings,
          level: "trace",
        });

        const inputs = result.inputs as Record<string, unknown>;

        // trace-sourced "input" field should contain the trace input value
        expect(inputs.input).toBe("user message");

        // thread-sourced "conversation" field should contain the formatted thread digest
        expect(typeof inputs.conversation).toBe("string");
        expect((inputs.conversation as string).length).toBeGreaterThan(0);
      });
    });
  });

  // -------------------------------------------------------------------------
  // @integration Scenario: Trace-level evaluation with thread source but trace has no thread_id
  // -------------------------------------------------------------------------
  describe("given a trace-level evaluator with thread source but trace has no thread_id", () => {
    describe("when buildDataForEvaluation runs for a trace without thread_id", () => {
      it("resolves thread-sourced field to empty value and trace-sourced fields still resolve normally", async () => {
        const trace = buildTrace({
          input: { value: "hello there" },
          metadata: {},
        });

        const { service } = createTestService({ trace });

        const mappings: MappingState = {
          mapping: {
            input: { source: "input" },
            conversation: {
              type: "thread",
              source: "traces",
              selectedFields: ["input"],
            },
          },
          expansions: [],
        };

        const result = await service.executeForTrace({
          projectId: "proj-1",
          traceId: "trace-1",
          evaluatorType: "custom/my-eval",
          settings: null,
          mappings,
          level: "trace",
        });

        const inputs = result.inputs as Record<string, unknown>;

        // Trace-sourced fields still resolve normally
        expect(inputs.input).toBe("hello there");

        // Thread-sourced field resolves to an empty value
        expect(
          inputs.conversation === "" ||
            inputs.conversation === undefined ||
            inputs.conversation === null ||
            (Array.isArray(inputs.conversation) &&
              (inputs.conversation as any[]).length === 0),
        ).toBe(true);

        // Evaluation does not fail
        expect(result.status).toBe("processed");
      });
    });
  });

  // -------------------------------------------------------------------------
  // @integration Scenario: Background worker resolves mixed trace and thread mappings
  // (tested via EvaluationExecutionService which shares the same resolution logic)
  // -------------------------------------------------------------------------
  describe("given a trace-level monitor with mixed trace and thread mappings", () => {
    describe("when the evaluations worker processes a trace with thread_id 'xyz'", () => {
      it("resolves both trace and thread fields correctly", async () => {
        const trace = buildTrace({
          input: { value: "worker input" },
          output: { value: "worker output" },
          metadata: { thread_id: "xyz" },
        });

        const threadTraces = [
          buildTrace({
            trace_id: "wt1",
            input: { value: "msg1" },
            metadata: { thread_id: "xyz" },
          }),
          buildTrace({
            trace_id: "wt2",
            input: { value: "msg2" },
            metadata: { thread_id: "xyz" },
          }),
        ];

        const { service } = createTestService({
          trace,
          traceService: {
            getTracesWithSpansByThreadIds: vi
              .fn()
              .mockResolvedValue(threadTraces),
          },
        });

        const mappings: MappingState = {
          mapping: {
            input: { source: "input" },
            history: {
              type: "thread",
              source: "traces",
              selectedFields: ["input"],
            },
          },
          expansions: [],
        };

        const result = await service.executeForTrace({
          projectId: "proj-1",
          traceId: "trace-1",
          evaluatorType: "custom/worker-eval",
          settings: null,
          mappings,
          level: "trace",
        });

        const inputs = result.inputs as Record<string, unknown>;

        // Trace field resolves
        expect(inputs.input).toBe("worker input");

        // Thread field resolves
        expect(Array.isArray(inputs.history)).toBe(true);
        const history = inputs.history as Record<string, unknown>[];
        expect(history.length).toBe(2);
        expect(history[0]!.input).toBe("msg1");
        expect(history[1]!.input).toBe("msg2");
      });
    });
  });
});
