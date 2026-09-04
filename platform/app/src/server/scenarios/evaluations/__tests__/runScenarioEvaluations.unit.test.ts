import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "~/generated/prisma/client";
import type { SingleEvaluationResult } from "~/server/evaluations/evaluators.generated";
import type { EvaluatorWithFields } from "~/server/evaluators/evaluator.service";
import type { Span } from "~/server/tracer/types";
import type { EvaluatorAttachment } from "../../evaluator-attachments";
import { MAX_STORED_INPUT_LENGTH } from "../constants";
import {
  checkTypeOf,
  type RunScenarioEvaluationsDeps,
  runScenarioEvaluations,
  TraceDataPendingError,
  toScenarioEvaluationResult,
} from "../runScenarioEvaluations";
import type { ScenarioEvaluationsJobPayload } from "../types";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const projectId = "project-1";

const evaluator = (
  overrides: Partial<EvaluatorWithFields> = {},
): EvaluatorWithFields =>
  ({
    id: "eval-exact",
    projectId,
    name: "Exact match",
    slug: "exact-match",
    type: "evaluator",
    config: {
      evaluatorType: "langevals/exact_match",
      settings: { case_sensitive: true },
    },
    workflowId: null,
    fields: [
      { identifier: "output", type: "str" },
      { identifier: "expected_output", type: "str" },
    ],
    outputFields: [],
    ...overrides,
  }) as EvaluatorWithFields;

const outputMapping = {
  type: "source" as const,
  sourceId: "conversation" as const,
  path: ["last_agent_message"],
};
const goldenMapping = {
  type: "source" as const,
  sourceId: "scenario" as const,
  path: ["fields", "golden_sql"],
};
const toolMapping = {
  type: "source" as const,
  sourceId: "trace" as const,
  path: ["tool_calls", "run_sql", "input"],
};

const attachment = (
  overrides: Partial<EvaluatorAttachment> = {},
): EvaluatorAttachment => ({
  id: "att-1",
  evaluatorId: "eval-exact",
  required: true,
  mappings: { output: outputMapping, expected_output: goldenMapping },
  ...overrides,
});

const payload: ScenarioEvaluationsJobPayload = {
  tenantId: projectId,
  scenarioRunId: "run-1",
  scenarioId: "scenario-1",
  suiteId: "suite-1",
  planId: "suite-1",
  traceIds: ["trace-1"],
  attempt: 1,
  occurredAt: 1_000,
};

const processed = (
  result: Partial<Extract<SingleEvaluationResult, { status: "processed" }>>,
): SingleEvaluationResult => ({ status: "processed", ...result });

function makeDeps({
  attachments = [attachment()],
  evaluators = [evaluator()],
  fields = { golden_sql: "SELECT 1" } as Prisma.JsonValue,
  spans = [] as Span[],
  traceIds = ["trace-1"],
  result = processed({ passed: true, score: 1 }) as
    | SingleEvaluationResult
    | Error,
}: {
  attachments?: EvaluatorAttachment[];
  evaluators?: EvaluatorWithFields[];
  fields?: Prisma.JsonValue;
  spans?: Span[];
  traceIds?: string[];
  result?: SingleEvaluationResult | Error;
} = {}) {
  const deps: RunScenarioEvaluationsDeps = {
    scenarios: {
      getById: vi.fn(async () => ({
        id: "scenario-1",
        situation: "A customer asks for a refund count",
        criteria: ["The agent answers"],
        fields,
        testSuiteId: "suite-1",
      })),
    },
    suites: {
      getRunAttachments: vi.fn(async () => attachments),
      getAttachedEvaluators: vi.fn(
        async () => new Map(evaluators.map((entry) => [entry.id, entry])),
      ),
    },
    runs: {
      getRunState: vi.fn(async () => ({
        messages: [
          { role: "user", content: "How many refunds?" },
          { role: "assistant", content: "SELECT 1" },
        ],
        traceIds,
      })),
    },
    spans: { getSpansByTraceId: vi.fn(async () => spans) },
    runEvaluation: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
    reportEvaluation: vi.fn(async () => {}),
    recordEvaluations: vi.fn(async () => {}),
  };
  return deps;
}

const recorded = (deps: RunScenarioEvaluationsDeps) =>
  vi.mocked(deps.recordEvaluations).mock.calls[0]?.[0];

describe("runScenarioEvaluations", () => {
  describe("given an exact match evaluator mapped to the last agent message and a field", () => {
    /** @scenario "A finished run with attached evaluators is graded on the platform" */
    it("runs the evaluator with the resolved inputs and records a passed result", async () => {
      const deps = makeDeps();

      await runScenarioEvaluations({ deps, payload, isFinalAttempt: false });

      expect(deps.runEvaluation).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId,
          evaluatorType: "langevals/exact_match",
          data: {
            type: "default",
            data: { output: "SELECT 1", expected_output: "SELECT 1" },
          },
          settings: { case_sensitive: true },
          trace: expect.objectContaining({ trace_id: "trace-1" }),
        }),
      );
      expect(recorded(deps)).toEqual({
        tenantId: projectId,
        scenarioRunId: "run-1",
        occurredAt: expect.any(Number),
        evaluations: [
          {
            evaluatorId: "eval-exact",
            name: "Exact match",
            status: "passed",
            required: true,
            passed: true,
            score: 1,
            inputs: { output: "SELECT 1", expected_output: "SELECT 1" },
          },
        ],
      });
      expect(deps.reportEvaluation).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: projectId,
          evaluatorId: "eval-exact",
          evaluatorType: "langevals/exact_match",
          evaluatorName: "Exact match",
          traceId: "trace-1",
          status: "processed",
          passed: true,
          score: 1,
        }),
      );
    });
  });

  describe("when the scenario carries no value for the mapped field", () => {
    /** @scenario "A blank scenario field skips the evaluator with a reason" */
    it("does not run the evaluator and records a skipped result", async () => {
      const deps = makeDeps({ fields: {} });

      await runScenarioEvaluations({ deps, payload, isFinalAttempt: false });

      expect(deps.runEvaluation).not.toHaveBeenCalled();
      expect(deps.reportEvaluation).not.toHaveBeenCalled();
      expect(recorded(deps)?.evaluations).toEqual([
        {
          evaluatorId: "eval-exact",
          name: "Exact match",
          status: "skipped",
          required: true,
          details: "no golden_sql on this scenario",
        },
      ]);
    });
  });

  describe("when the evaluator reads a tool call the trace does not hold", () => {
    const toolAttachment = attachment({
      mappings: { output: toolMapping, expected_output: goldenMapping },
    });
    const otherSpan = {
      span_id: "s1",
      trace_id: "trace-1",
      type: "llm",
      name: "chat",
      timestamps: { started_at: 1, finished_at: 2, first_token_at: null },
    } as unknown as Span;

    /** @scenario "A tool call the trace does not hold fails the evaluator with a reason" */
    it("records a failed result on the last attempt", async () => {
      const deps = makeDeps({
        attachments: [toolAttachment],
        spans: [otherSpan],
      });

      await runScenarioEvaluations({ deps, payload, isFinalAttempt: true });

      expect(deps.runEvaluation).not.toHaveBeenCalled();
      expect(recorded(deps)?.evaluations).toEqual([
        expect.objectContaining({
          status: "failed",
          passed: false,
          details: "no run_sql call in the trace",
        }),
      ]);
    });

    /** @scenario "Trace data that has not arrived yet is retried with a growing delay" */
    it("asks for a retry when the spans have not arrived and it is not the last attempt", async () => {
      const deps = makeDeps({ attachments: [toolAttachment], spans: [] });

      await expect(
        runScenarioEvaluations({ deps, payload, isFinalAttempt: false }),
      ).rejects.toBeInstanceOf(TraceDataPendingError);
      expect(deps.recordEvaluations).not.toHaveBeenCalled();
    });

    it("records the missing call as failed once the attempts are used up", async () => {
      const deps = makeDeps({ attachments: [toolAttachment], spans: [] });

      await runScenarioEvaluations({ deps, payload, isFinalAttempt: true });

      expect(recorded(deps)?.evaluations[0]).toEqual(
        expect.objectContaining({
          status: "failed",
          details: "no run_sql call in the trace",
        }),
      );
    });

    it("loads the spans of every trace the run produced", async () => {
      const deps = makeDeps({
        attachments: [toolAttachment],
        traceIds: ["trace-1", "trace-2"],
      });

      await runScenarioEvaluations({ deps, payload, isFinalAttempt: true });

      expect(deps.spans.getSpansByTraceId).toHaveBeenCalledTimes(2);
      expect(deps.spans.getSpansByTraceId).toHaveBeenCalledWith({
        tenantId: projectId,
        traceId: "trace-2",
      });
    });
  });

  describe("when an evaluator reports an error", () => {
    /** @scenario "An evaluator error is recorded as an error result" */
    it("records the error and the other evaluators still record their results", async () => {
      const failing = evaluator({ id: "eval-failing", name: "Judge" });
      const deps = makeDeps({
        attachments: [
          attachment({ id: "att-failing", evaluatorId: "eval-failing" }),
          attachment(),
        ],
        evaluators: [failing, evaluator()],
      });
      vi.mocked(deps.runEvaluation)
        .mockResolvedValueOnce({
          status: "error",
          error_type: "PROVIDER_ERROR",
          details: "model not available",
          traceback: [],
        })
        .mockResolvedValueOnce(processed({ passed: true }));

      await runScenarioEvaluations({ deps, payload, isFinalAttempt: false });

      expect(recorded(deps)?.evaluations).toEqual([
        expect.objectContaining({
          evaluatorId: "eval-failing",
          status: "error",
          details: "model not available",
        }),
        expect.objectContaining({
          evaluatorId: "eval-exact",
          status: "passed",
        }),
      ]);
      expect(deps.reportEvaluation).toHaveBeenCalledWith(
        expect.objectContaining({
          evaluatorId: "eval-failing",
          status: "error",
          error: "model not available",
        }),
      );
    });

    it("records a thrown runner error as an error result", async () => {
      const deps = makeDeps({ result: new Error("langevals unreachable") });

      await runScenarioEvaluations({ deps, payload, isFinalAttempt: false });

      expect(recorded(deps)?.evaluations[0]).toEqual(
        expect.objectContaining({
          status: "error",
          details: "langevals unreachable",
        }),
      );
    });
  });

  describe("when an attachment names an evaluator the project does not have", () => {
    /** @scenario "An evaluator the project no longer holds is recorded as an error" */
    it("records an error result that says so", async () => {
      const deps = makeDeps({ evaluators: [] });

      await runScenarioEvaluations({ deps, payload, isFinalAttempt: false });

      expect(deps.runEvaluation).not.toHaveBeenCalled();
      expect(recorded(deps)?.evaluations).toEqual([
        {
          evaluatorId: "eval-exact",
          name: "eval-exact",
          status: "error",
          required: true,
          details: "The evaluator was not found in this project",
        },
      ]);
    });
  });

  describe("when a resolved input is longer than the stored cap", () => {
    /** @scenario "Stored inputs are cut to two thousand characters" */
    it("stores the cut text and gives the evaluator the whole value", async () => {
      const long = "y".repeat(MAX_STORED_INPUT_LENGTH + 100);
      const deps = makeDeps({ fields: { golden_sql: long } });

      await runScenarioEvaluations({ deps, payload, isFinalAttempt: false });

      expect(
        vi.mocked(deps.runEvaluation).mock.calls[0]?.[0].data.data
          .expected_output,
      ).toHaveLength(long.length);
      expect(
        recorded(deps)?.evaluations[0]?.inputs?.expected_output,
      ).toHaveLength(MAX_STORED_INPUT_LENGTH);
    });
  });

  describe("when the run produced no trace", () => {
    it("runs the evaluator without a trace and reports nothing on a trace", async () => {
      const deps = makeDeps({ traceIds: [] });

      await runScenarioEvaluations({
        deps,
        payload: { ...payload, traceIds: [] },
        isFinalAttempt: false,
      });

      expect(deps.runEvaluation).toHaveBeenCalledWith(
        expect.objectContaining({ trace: undefined }),
      );
      expect(deps.reportEvaluation).not.toHaveBeenCalled();
      expect(recorded(deps)?.evaluations[0]?.status).toBe("passed");
    });
  });

  describe("when writing the evaluation on the trace fails", () => {
    /** @scenario "A trace report failure does not lose a graded result" */
    it("still records the result instead of failing the whole run", async () => {
      const deps = makeDeps();
      vi.mocked(deps.reportEvaluation).mockRejectedValueOnce(
        new Error("clickhouse unavailable"),
      );

      await expect(
        runScenarioEvaluations({ deps, payload, isFinalAttempt: false }),
      ).resolves.toBeDefined();

      expect(deps.recordEvaluations).toHaveBeenCalledTimes(1);
      expect(recorded(deps)?.evaluations[0]).toEqual(
        expect.objectContaining({ evaluatorId: "eval-exact", status: "passed" }),
      );
    });
  });
});

describe("toScenarioEvaluationResult", () => {
  const base = {
    attachment: { evaluatorId: "eval-1", required: false },
    name: "Judge",
    inputs: {},
  };

  /** @scenario "A score-only result is recorded as scored" */
  it("records a score without a pass as scored, and a pass as passed or failed", () => {
    expect(
      toScenarioEvaluationResult({
        ...base,
        result: processed({ score: 0.8, label: "good", details: "fine" }),
      }),
    ).toEqual({
      evaluatorId: "eval-1",
      name: "Judge",
      required: false,
      status: "scored",
      score: 0.8,
      label: "good",
      details: "fine",
    });
    expect(
      toScenarioEvaluationResult({
        ...base,
        result: processed({ passed: true }),
      }).status,
    ).toBe("passed");
    expect(
      toScenarioEvaluationResult({
        ...base,
        result: processed({
          passed: false,
          cost: { currency: "USD", amount: 0.01 },
        }),
      }),
    ).toEqual(
      expect.objectContaining({
        status: "failed",
        passed: false,
        cost: { currency: "USD", amount: 0.01 },
      }),
    );
  });

  /** @scenario "A result with no label and no details is recorded without them" */
  it("leaves out a label and details the runner spelled as null", () => {
    const result = toScenarioEvaluationResult({
      ...base,
      result: {
        ...processed({ passed: true, score: 1 }),
        label: null,
        details: null,
      } as never,
    });
    expect(result).toEqual({
      evaluatorId: "eval-1",
      name: "Judge",
      required: false,
      status: "passed",
      passed: true,
      score: 1,
    });
    expect("label" in result).toBe(false);
    expect("details" in result).toBe(false);
  });
});

describe("checkTypeOf", () => {
  it("dispatches a workflow evaluator on its workflow, a code one on its id, a built-in on its type", () => {
    expect(
      checkTypeOf(evaluator({ type: "workflow", workflowId: "wf-1" })),
    ).toBe("custom/wf-1");
    expect(checkTypeOf(evaluator({ type: "code", id: "eval-code" }))).toBe(
      "code/eval-code",
    );
    expect(checkTypeOf(evaluator())).toBe("langevals/exact_match");
    expect(checkTypeOf(evaluator({ config: {} }))).toBeNull();
  });
});
