/**
 * Answers one LLM judge whose model is Instant Evals through the judge leaf, before any provider
 * lookup (ADR-174 decisions 1, 7, 9, 16). A stream chunk is skipped before the judge is called,
 * and a refusal comes back as an error result, never thrown, so no caller reads it as a skip.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import type { GuardrailCheckDirection } from "@langwatch/evaluation-contract";
import type { EvaluatorApi, SingleEvaluationResult } from "@langwatch/evaluator-contract";
import type { InstantEvalJudgeApi } from "@langwatch/instant-eval-judge-contract";

import { instantEvalGuardrailSkipOf } from "../rules/instant-eval-guardrail-skip.rules.ts";
import { instantEvalJudgeInputsOf } from "../rules/instant-eval-judge-dispatch.rules.ts";
import {
  buildInstantEvalJudgeRequest,
  type InstantEvalJudge,
} from "../rules/instant-eval-judge-question.rules.ts";
import {
  instantEvalJudgeResult,
  instantEvalRefusalResultOf,
  instantEvalSkipResultOf,
} from "../rules/instant-eval-judge-result.rules.ts";

type EvaluationInstantEvalJudgeDeps = Readonly<{
  judges: Pick<InstantEvalJudgeApi, "judge">;
  /** The shared augmenter every judge's result runs through, so a leak is never hidden. */
  evaluators: Pick<EvaluatorApi, "augmentResult">;
}>;

export class EvaluationInstantEvalJudgeService {
  private constructor(private readonly deps: EvaluationInstantEvalJudgeDeps) {}

  static create(deps: EvaluationInstantEvalJudgeDeps): EvaluationInstantEvalJudgeService {
    return new EvaluationInstantEvalJudgeService(deps);
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
  }: {
    projectId: string;
    judge: InstantEvalJudge;
    mappedData: Record<string, unknown>;
    idempotencyKey?: string | undefined;
    guardrailDirection?: GuardrailCheckDirection | undefined;
    signal?: AbortSignal | undefined;
  }): Promise<SingleEvaluationResult> {
    const guardrailSkip = instantEvalGuardrailSkipOf({ direction: guardrailDirection });
    if (guardrailSkip) return guardrailSkip;

    const inputs = instantEvalJudgeInputsOf(mappedData);
    const request = buildInstantEvalJudgeRequest({ judge, inputs });
    if (request.kind === "nothing_to_judge") return instantEvalSkipResultOf("nothing_to_judge");

    const answer = await this.deps.judges.judge({
      projectId,
      text: request.text,
      questions: [request.question],
      ...(idempotencyKey === undefined ? {} : { requestKey: idempotencyKey }),
      ...(signal === undefined ? {} : { signal }),
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
