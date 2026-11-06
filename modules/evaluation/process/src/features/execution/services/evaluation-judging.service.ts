/**
 * Answers one LLM judge whose model is Instant Evals through the judge leaf, before any provider
 * lookup (ADR-174 d1, 7, 9, 16). A stream chunk is skipped before the call, a refusal is an error
 * result, never thrown. LangWatch's model is routed under the judge router flag (ADR-190).
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import type { GuardrailCheckDirection } from "@langwatch/evaluation-contract";
import type { EvaluatorApi, SingleEvaluationResult } from "@langwatch/evaluator-contract";
import {
  instantEvalOwnDecisionModelOf,
  instantEvalUnavailableDecisionModelSkipOf,
  type InstantEvalJudgeApi,
  type InstantEvalJudgeRouteRequest,
} from "@langwatch/instant-eval-judge-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";

import { instantEvalGuardrailSkipOf } from "../../../rules/instant-eval-guardrail-skip.rules.ts";
import { instantEvalJudgeInputsOf } from "../../../rules/instant-eval-judge-dispatch.rules.ts";
import {
  buildInstantEvalJudgeRequest,
  type InstantEvalJudge,
} from "../../../rules/instant-eval-judge-question.rules.ts";
import {
  instantEvalJudgeResult,
  instantEvalRefusalResultOf,
  instantEvalSkipResultOf,
} from "../../../rules/instant-eval-judge-result.rules.ts";

type EvaluationJudgingDeps = Readonly<{
  judges: Pick<InstantEvalJudgeApi, "judge">;
  /** The project's Instant Evals column: LangWatch's classifier or its own model (ADR-182). */
  decisionModels: Pick<ModelProviderApi, "resolveDecisionModel">;
  /** The shared augmenter every judge's result runs through, so a leak is never hidden. */
  evaluators: Pick<EvaluatorApi, "augmentResult">;
  /** Whether the project's organization has the judge router flag (ADR-190 decision 8). */
  judgeRouting: EvaluationJudgeRouting;
}>;

export type EvaluationJudgeRouting = Readonly<{
  isRouted: (input: { projectId: string }) => Promise<boolean>;
}>;

/** What an LLM-as-judge evaluator asks the router for; the table picks its slot and mode. */
const LLM_JUDGE_ROUTE: InstantEvalJudgeRouteRequest = { job: "llm_judge" };

export class EvaluationJudgingService {
  private constructor(private readonly deps: EvaluationJudgingDeps) {}

  static create(deps: EvaluationJudgingDeps): EvaluationJudgingService {
    return new EvaluationJudgingService(deps);
  }

  async answer({
    judge,
    data,
    settings,
    droppedCategories,
    ...call
  }: {
    projectId: string;
    judge: InstantEvalJudge;
    data: Readonly<{ data: Record<string, unknown> }>;
    settings?: Record<string, unknown> | undefined;
    droppedCategories: string[];
    /** The decision model this judge picked; the resolver weighs it, the guards are unchanged. */
    decisionModel?: string | undefined;
    /** Only a queued monitor command carries one; it becomes the retry key (decision 9). */
    idempotencyKey?: string | undefined;
    guardrailDirection?: GuardrailCheckDirection | undefined;
    signal?: AbortSignal | undefined;
  }): Promise<SingleEvaluationResult> {
    const result = await this.judged({ ...call, judge, mappedData: data.data });
    return this.deps.evaluators.augmentResult({
      evaluatorType: judge.evaluatorType,
      mappedData: data.data,
      settings,
      droppedCategories,
      result,
    });
  }

  private async judged({
    projectId,
    judge,
    mappedData,
    idempotencyKey,
    guardrailDirection,
    signal,
    decisionModel,
  }: {
    projectId: string;
    judge: InstantEvalJudge;
    mappedData: Record<string, unknown>;
    idempotencyKey?: string | undefined;
    guardrailDirection?: GuardrailCheckDirection | undefined;
    signal?: AbortSignal | undefined;
    decisionModel?: string | undefined;
  }): Promise<SingleEvaluationResult> {
    const guardrailSkip = instantEvalGuardrailSkipOf({ direction: guardrailDirection });
    if (guardrailSkip.kind === "skipped") return guardrailSkip.result;

    const inputs = instantEvalJudgeInputsOf(mappedData);
    const request = buildInstantEvalJudgeRequest({ judge, inputs });
    if (request.kind === "nothing_to_judge") return instantEvalSkipResultOf("nothing_to_judge");

    const resolved = await this.deps.decisionModels.resolveDecisionModel({
      projectId,
      ...(decisionModel === undefined ? {} : { model: decisionModel }),
    });
    // A broken own key never falls back to LangWatch's classifier (ADR-182 decision 9).
    if (resolved.kind === "own_unavailable") {
      return instantEvalSkipResultOf(instantEvalUnavailableDecisionModelSkipOf(resolved));
    }
    // An own decision model is never routed, so the flag is read on LangWatch's model only.
    const isRouted =
      resolved.kind === "langwatch" && (await this.deps.judgeRouting.isRouted({ projectId }));
    const answer = await this.deps.judges.judge({
      projectId,
      text: request.text,
      questions: [request.question],
      ...(idempotencyKey === undefined ? {} : { requestKey: idempotencyKey }),
      ...(signal === undefined ? {} : { signal }),
      ...(resolved.kind === "own"
        ? { decisionModel: instantEvalOwnDecisionModelOf(resolved) }
        : {}),
      ...(isRouted ? { route: LLM_JUDGE_ROUTE } : {}),
    });
    if (answer.outcome === "refused") {
      return instantEvalRefusalResultOf({ code: answer.code, message: answer.message });
    }
    return instantEvalJudgeResult({
      judge,
      judgement: answer.judgement,
      priceUsd: answer.priceUsd,
    });
  }
}
