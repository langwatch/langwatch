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
import type { DecisionModelResolution, ModelProviderApi } from "@langwatch/model-provider-contract";
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

function buildService({
  judge = judgedTrue,
  decisionModel = { kind: "langwatch" },
  isRouted = false,
}: {
  judge?: Judge;
  decisionModel?: DecisionModelResolution;
  isRouted?: boolean;
} = {}) {
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
  const resolveDecisionModel = vi
    .fn<ModelProviderApi["resolveDecisionModel"]>()
    .mockResolvedValue(decisionModel);
  const isRoutedSpy = vi.fn(async (_input: { projectId: string }) => isRouted);

  const service = EvaluationExecutionService.create({
    runs: { findTraceEvaluations: async () => [] },
    authz: {
      authorizeInternal: async () => {
        throw new Error("these cases read no earlier evaluations");
      },
    },
    traces: {
      readTracesWithSpans: vi.fn().mockResolvedValue([buildTrace()]),
      readThreadsTraces: vi.fn().mockResolvedValue([]),
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
    decisionModels: createApiFixture<ModelProviderApi>({
      resolveDecisionModel: resolveDecisionModel,
    }),
    judgeRouting: { isRouted: isRoutedSpy },
    installEnvironment: {},
  });

  return {
    service,
    judge: judgeSpy,
    calls,
    resolveForEvaluator,
    evaluate,
    resolveDecisionModel,
    isRouted: isRoutedSpy,
  };
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

describe("EvaluationExecutionService with a judge on an own decision model", () => {
  const OWN = {
    kind: "own",
    model: "inception/decisions:mercury-decide",
    wire: "jev",
    providerModel: "mercury-decide",
    endpoint: "https://api.inceptionlabs.ai/v1/decisions",
    authHeader: "bearer",
    apiKey: "customer-key",
  } as const satisfies DecisionModelResolution;

  describe("given the project's own decision model resolves with its key", () => {
    it("passes the own model to the judge", async () => {
      const { service, calls } = buildService({ decisionModel: OWN });

      await service.executeForTrace({
        projectId: PROJECT_ID,
        traceId: "trace-1",
        evaluatorType: "langevals/llm_boolean",
        settings: BOOLEAN_SETTINGS,
        mappings: null,
      });

      expect(calls[0]?.decisionModel).toMatchObject({
        model: "inception/decisions:mercury-decide",
        apiKey: "customer-key",
      });
    });
  });

  describe("given the project's own decision model has no key", () => {
    /** @scenario "An LLM judge on an unavailable own decision model says how to fix it" */
    it("answers an error naming the key and the next step, without calling the judge", async () => {
      const { service, judge } = buildService({
        decisionModel: {
          kind: "own_unavailable",
          model: "inception/decisions:mercury-decide",
          reason: "key_missing",
        },
      });

      const result = await service.executeForTrace({
        projectId: PROJECT_ID,
        traceId: "trace-1",
        evaluatorType: "langevals/llm_boolean",
        settings: BOOLEAN_SETTINGS,
        mappings: null,
      });

      expect(judge).not.toHaveBeenCalled();
      expect(result.status).toBe("error");
      const error = result.status === "error" ? result.error : "";
      expect(error).toContain("classifier_key_invalid");
      expect(error).toContain("Settings > Model Providers");
    });
  });

  describe("given a judge that picked an own decision model of its own", () => {
    const OWN_SETTINGS = { model: OWN.model, prompt: "is the answer polite?" };

    /** @scenario "A judge on an own decision model runs on it" */
    it("resolves its pick as the override and judges on that model", async () => {
      const { service, calls, resolveDecisionModel } = buildService({ decisionModel: OWN });

      await service.executeForTrace({
        projectId: PROJECT_ID,
        traceId: "trace-1",
        evaluatorType: "langevals/llm_boolean",
        settings: OWN_SETTINGS,
        mappings: null,
      });

      expect(resolveDecisionModel).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        model: OWN.model,
      });
      expect(calls[0]?.decisionModel).toMatchObject({ model: OWN.model, apiKey: "customer-key" });
    });

    /** @scenario "A judge whose own decision model cannot run is an error, never moved onto the hosted model" */
    it("answers an error naming the key and never calls LangWatch's classifier", async () => {
      const { service, judge, resolveDecisionModel } = buildService({
        decisionModel: { kind: "own_unavailable", model: OWN.model, reason: "key_missing" },
      });

      const result = await service.executeForTrace({
        projectId: PROJECT_ID,
        traceId: "trace-1",
        evaluatorType: "langevals/llm_boolean",
        settings: OWN_SETTINGS,
        mappings: null,
      });

      expect(resolveDecisionModel).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        model: OWN.model,
      });
      expect(judge).not.toHaveBeenCalled();
      expect(result.status).toBe("error");
      expect(result.status === "error" ? result.error : "").toContain("classifier_key_invalid");
    });

    /** @scenario "A judge holding an own pick with the flag off is an error" */
    it("answers an error naming the classifier as not configured, never the hosted one", async () => {
      const { service, judge } = buildService({
        decisionModel: { kind: "own_unavailable", model: OWN.model, reason: "not_enabled" },
      });

      const result = await service.executeForTrace({
        projectId: PROJECT_ID,
        traceId: "trace-1",
        evaluatorType: "langevals/llm_boolean",
        settings: OWN_SETTINGS,
        mappings: null,
      });

      expect(judge).not.toHaveBeenCalled();
      expect(result.status).toBe("error");
      expect(result.status === "error" ? result.error : "").toContain("classifier_not_configured");
    });
  });

  describe("given a judge left on Instant Evals in a project whose column is an own model", () => {
    /** @scenario "A judge expressing no decision model runs on the project's column" */
    it("resolves with no override, so the column's own model answers it", async () => {
      const { service, calls, resolveDecisionModel } = buildService({ decisionModel: OWN });

      await service.executeForTrace({
        projectId: PROJECT_ID,
        traceId: "trace-1",
        evaluatorType: "langevals/llm_boolean",
        settings: BOOLEAN_SETTINGS,
        mappings: null,
      });

      expect(resolveDecisionModel).toHaveBeenCalledWith({ projectId: PROJECT_ID });
      expect(calls[0]?.decisionModel).toMatchObject({ model: OWN.model });
    });
  });
});

describe("EvaluationExecutionService with the judge router", () => {
  const runBooleanJudge = (service: EvaluationExecutionService) =>
    service.executeForTrace({
      projectId: PROJECT_ID,
      traceId: "trace-1",
      evaluatorType: "langevals/llm_boolean",
      settings: BOOLEAN_SETTINGS,
      mappings: null,
    });

  describe("given the router flag is on and the project runs on LangWatch Evals Preview", () => {
    /** @scenario "An LLM judge on LangWatch Evals Preview is routed when the flag is on" */
    it("sends the llm_judge route with the judge call", async () => {
      const { service, calls, isRouted } = buildService({ isRouted: true });

      await runBooleanJudge(service);

      expect(isRouted).toHaveBeenCalledWith({ projectId: PROJECT_ID });
      expect(calls[0]?.route).toEqual({ job: "llm_judge" });
      expect(calls[0]?.decisionModel).toBeUndefined();
    });
  });

  describe("given the router flag is off", () => {
    /** @scenario "With the router flag off an LLM judge keeps today's single classifier call" */
    it("sends no route", async () => {
      const { service, calls } = buildService({ isRouted: false });

      await runBooleanJudge(service);

      expect(calls[0]).not.toHaveProperty("route");
    });
  });

  describe("given the router flag is on and the project runs on its own decision model", () => {
    /** @scenario "An own decision model is never routed" */
    it("sends the own model, no route, and never reads the flag", async () => {
      const { service, calls, isRouted } = buildService({
        isRouted: true,
        decisionModel: {
          kind: "own",
          model: "openai/decisions:gpt-6-luna",
          wire: "openai_decisions",
          providerModel: "gpt-6-luna",
          endpoint: "https://api.openai.com/v1/decisions",
          authHeader: "bearer",
          apiKey: "customer-key",
        },
      });

      await runBooleanJudge(service);

      expect(isRouted).not.toHaveBeenCalled();
      expect(calls[0]).not.toHaveProperty("route");
      expect(calls[0]?.decisionModel).toMatchObject({ model: "openai/decisions:gpt-6-luna" });
    });
  });
});
