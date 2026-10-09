/**
 * The evaluation answers a judge whose model is Instant Evals through the judge leaf, before
 * any provider lookup (ADR-174 decisions 1, 7, 9, 11, 16).
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import type { EvaluationCostRecord } from "@langwatch/evaluation-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import {
  INSTANT_EVAL_JUDGE_MODEL_ID,
  type InstantEvalJudgeApi,
  type InstantEvalJudgeCall,
} from "@langwatch/instant-eval-judge-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { Trace } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import type { EvaluatorModelEnvService } from "../../../evaluators/services/evaluator-model-env.service.ts";
import type { LangevalsEvaluatorService } from "../../../evaluators/services/langevals-evaluator.service.ts";
import { EvaluationExecutionService } from "../evaluation-execution.service.ts";
import { EvaluationGuardrailCheckService } from "../evaluation-guardrail-check.service.ts";

const PROJECT_ID = "proj-1";
const PRICE_USD = 0.00042;
const BOOLEAN_SETTINGS = { model: INSTANT_EVAL_JUDGE_MODEL_ID, prompt: "is the answer polite?" };

type Judge = InstantEvalJudgeApi["judge"];

const judgedTrue: Judge = async () => ({
  outcome: "judged",
  judgement: {
    verdicts: [{ questionId: "judge", probability: 0.9 }],
    inputTokens: 500,
    isTextTruncated: false,
  },
  priceUsd: PRICE_USD,
});

function buildTrace(): Trace {
  return {
    trace_id: "trace-1",
    project_id: PROJECT_ID,
    metadata: {},
    input: { value: "hello" },
    output: { value: "hi, how can I help?" },
    timestamps: { started_at: Date.now(), inserted_at: Date.now(), updated_at: Date.now() },
    spans: [],
  };
}

function buildService({ judge = judgedTrue }: { judge?: Judge } = {}) {
  const calls: InstantEvalJudgeCall[] = [];
  const judgeSpy = vi.fn<Judge>(async (input) => {
    calls.push(input);
    return judge(input);
  });
  const resolveForEvaluator = vi
    .fn<EvaluatorModelEnvService["resolveForEvaluator"]>()
    .mockResolvedValue({});
  const evaluate = vi
    .fn<LangevalsEvaluatorService["evaluate"]>()
    .mockResolvedValue({ status: "processed", passed: true, score: 1 });

  const service = EvaluationExecutionService.create({
    traces: {
      readTracesWithSpans: vi.fn().mockResolvedValue([buildTrace()]),
      readThreadsTraces: vi.fn().mockResolvedValue([]),
      readEvaluations: vi.fn().mockResolvedValue({}),
    },
    spanDigest: {
      format: vi.fn().mockResolvedValue(""),
      formatThread: vi.fn().mockResolvedValue(""),
    },
    modelEnvResolver: { resolveForEvaluator },
    langevalsClient: { evaluate },
    evaluators: createApiFixture<EvaluatorApi>({ augmentResult: ({ result }) => result }),
    workflowExecutor: {
      run: () => {
        throw new Error("a judge never runs an evaluation workflow");
      },
    },
    judges: { judge: judgeSpy },
    installEnvironment: {},
  });

  return { service, judge: judgeSpy, calls, resolveForEvaluator, evaluate };
}

function guardrailCheckWith(service: EvaluationExecutionService) {
  const costs: EvaluationCostRecord[] = [];
  const check = EvaluationGuardrailCheckService.create({
    runner: { runEvaluation: (input) => service.executeForData(input) },
    ledger: {
      recordCost: async (input) => {
        costs.push(input);
        return { id: input.id };
      },
    },
  });
  return { check, costs };
}

const guardrail = { id: "gr-1", name: "Polite", monitorId: "mon-1" };

describe("EvaluationExecutionService with a judge on Instant Evals", () => {
  describe("given a boolean judge whose model is Instant Evals", () => {
    /** @scenario "A boolean judge on Instant Evals is classified, not sent to the evaluator service" */
    it("is answered by Instant Evals once, with no provider lookup and no evaluator service", async () => {
      const { service, judge, resolveForEvaluator, evaluate } = buildService();

      const result = await service.executeForTrace({
        projectId: PROJECT_ID,
        traceId: "trace-1",
        evaluatorType: "langevals/llm_boolean",
        settings: BOOLEAN_SETTINGS,
        mappings: null,
      });

      expect(judge).toHaveBeenCalledTimes(1);
      expect(evaluate).not.toHaveBeenCalled();
      expect(resolveForEvaluator).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        status: "processed",
        passed: true,
        cost: { currency: "USD", amount: PRICE_USD },
      });
    });

    it("asks one boolean question over the trace's labelled text", async () => {
      const { service, calls } = buildService();

      await service.executeForTrace({
        projectId: PROJECT_ID,
        traceId: "trace-1",
        evaluatorType: "langevals/llm_boolean",
        settings: BOOLEAN_SETTINGS,
        mappings: null,
      });

      expect(calls[0]).toMatchObject({
        projectId: PROJECT_ID,
        questions: [{ id: "judge", kind: "boolean", instructions: BOOLEAN_SETTINGS.prompt }],
      });
      expect(calls[0]?.text).toContain("# Output");
    });
  });

  describe("given a boolean judge whose model is a provider model", () => {
    /** @scenario "A judge on any other model is unchanged" */
    it("is answered by the evaluator service as today and never by Instant Evals", async () => {
      const { service, judge, evaluate } = buildService();

      await service.executeForTrace({
        projectId: PROJECT_ID,
        traceId: "trace-1",
        evaluatorType: "langevals/llm_boolean",
        settings: { model: "openai/gpt-5-mini", prompt: "is the answer polite?" },
        mappings: null,
      });

      expect(evaluate).toHaveBeenCalledTimes(1);
      expect(judge).not.toHaveBeenCalled();
    });
  });

  describe("given a judge on Instant Evals run from a queued evaluation command", () => {
    /** @scenario "A queued evaluation passes its retry key to the judge call" */
    it("carries the command's retry key on the judge call", async () => {
      const { service, calls } = buildService();

      await service.execute({
        projectId: PROJECT_ID,
        traceId: "trace-1",
        evaluatorType: "langevals/llm_boolean",
        settings: BOOLEAN_SETTINGS,
        mappings: null,
        idempotencyKey: `${PROJECT_ID}:eval-1:execution`,
      });

      expect(calls.map((call) => call.requestKey)).toEqual([`${PROJECT_ID}:eval-1:execution`]);
    });
  });

  describe("given a refused judge call", () => {
    /** @scenario "A refused judge is an error with the reason" */
    it.each([
      {
        refusal: "an organization whose free budget is spent",
        code: "instant_eval_free_budget_exhausted",
      },
      {
        refusal: "a project the Instant Evals judge has not learned yet",
        code: "instant_eval_project_unknown",
      },
    ] as const)("returns an error naming $code for $refusal", async ({ code }) => {
      const { service } = buildService({
        judge: async () => ({ outcome: "refused", code, message: "refused for this test" }),
      });

      // Resolves, never rejects: a thrown refusal would reach the outcome handler as a skip.
      const result = await service.executeForTrace({
        projectId: PROJECT_ID,
        traceId: "trace-1",
        evaluatorType: "langevals/llm_boolean",
        settings: BOOLEAN_SETTINGS,
        mappings: null,
      });

      expect(result).toMatchObject({ status: "error", error: expect.stringContaining(code) });
    });
  });

  describe("given a guardrail check on the stream chunk direction", () => {
    /** @scenario "A guardrail check on the stream chunk direction is skipped" */
    it("is skipped with the reason in its details and never calls Instant Evals", async () => {
      const { service, judge } = buildService();

      const result = await service.executeForData({
        projectId: PROJECT_ID,
        evaluatorType: "langevals/llm_boolean",
        data: { type: "default", data: { output: "a chunk" } },
        settings: BOOLEAN_SETTINGS,
        guardrailDirection: "stream_chunk",
      });

      expect(result).toEqual({
        status: "skipped",
        details: expect.stringContaining("guardrail_stream_chunk"),
      });
      expect(judge).not.toHaveBeenCalled();
    });
  });

  describe("given a guardrail check on the request or response direction", () => {
    /** @scenario "A guardrail check on the request or response direction is judged" */
    it.each(["request", "response"] as const)(
      "on the %s direction, Instant Evals answers it once",
      async (direction) => {
        const { service, judge } = buildService();
        const { check } = guardrailCheckWith(service);

        const outcome = await check.check({
          projectId: PROJECT_ID,
          evaluatorType: "langevals/llm_boolean",
          settings: BOOLEAN_SETTINGS,
          data: { input: "hello", output: "hi" },
          direction,
          guardrail,
        });

        expect(judge).toHaveBeenCalledTimes(1);
        expect(outcome).toMatchObject({ status: "evaluated", result: { status: "processed" } });
      },
    );
  });

  describe("given a guardrail whose judge is on Instant Evals", () => {
    /** @scenario "A guardrail check carries no retry key" */
    it("calls the judge with no retry key", async () => {
      const { service, calls } = buildService();
      const { check } = guardrailCheckWith(service);

      await check.check({
        projectId: PROJECT_ID,
        evaluatorType: "langevals/llm_boolean",
        settings: BOOLEAN_SETTINGS,
        data: { input: "hello", output: "hi" },
        direction: "request",
        guardrail,
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]?.requestKey).toBeUndefined();
    });

    /** @scenario "A guardrail check writes one cost row" */
    it("writes one guardrail cost row with the customer price", async () => {
      const { service } = buildService();
      const { check, costs } = guardrailCheckWith(service);

      await check.check({
        projectId: PROJECT_ID,
        evaluatorType: "langevals/llm_boolean",
        settings: BOOLEAN_SETTINGS,
        data: { input: "hello", output: "hi" },
        direction: "request",
        guardrail,
      });
      await vi.waitFor(() => expect(costs).toHaveLength(1));

      expect(costs[0]).toMatchObject({
        costType: "GUARDRAIL",
        amount: PRICE_USD,
        currency: "USD",
      });
    });
  });
});
