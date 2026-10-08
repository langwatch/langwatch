/**
 * Maps an Instant Evals judgement back to the result shape an LLM judge returns today
 * (ADR-174 decisions 3 to 7).
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */

import type { SingleEvaluationResult } from "@langwatch/evaluator-contract";
import {
  INSTANT_EVAL_SKIP_REASONS,
  type InstantEvalJudgeRefusalCode,
  type InstantEvalJudgement,
} from "@langwatch/instant-eval-judge-contract";

import {
  INSTANT_EVAL_JUDGE_QUESTION_ID,
  scoreOnJudgeRange,
  type InstantEvalJudge,
} from "./instant-eval-judge-question.rules.ts";

/** `passed` on a boolean judge: the probability of true against this. */
const BOOLEAN_THRESHOLD = 0.5;

/**
 * Every reason Instant Evals answers a judge without a verdict: the classifier's own, plus the two
 * the evaluation decides before calling it (nothing mapped, a guardrail's stream chunk).
 */
const INSTANT_EVAL_JUDGE_SKIP_REASONS = [
  ...INSTANT_EVAL_SKIP_REASONS,
  "nothing_to_judge",
  "guardrail_stream_chunk",
] as const;

type InstantEvalJudgeSkipReason = (typeof INSTANT_EVAL_JUDGE_SKIP_REASONS)[number];

/** The trace's own shape, never an outage, so these do not fire alerts. */
const SKIPPED_REASONS: ReadonlySet<InstantEvalJudgeSkipReason> = new Set([
  "classifier_input_too_large",
  "nothing_to_judge",
  "guardrail_stream_chunk",
]);

export function instantEvalJudgeResult({
  judge,
  judgement,
  priceUsd,
}: {
  judge: InstantEvalJudge;
  judgement: InstantEvalJudgement;
  priceUsd: number;
}): SingleEvaluationResult {
  if (judgement.skippedReason) return instantEvalSkipResultOf(judgement.skippedReason);
  const verdict = judgement.verdicts.find(
    ({ questionId }) => questionId === INSTANT_EVAL_JUDGE_QUESTION_ID,
  );
  if (!verdict) return instantEvalSkipResultOf("classifier_failed");
  const cost = { currency: "USD", amount: priceUsd };

  switch (judge.evaluatorType) {
    case "langevals/llm_boolean": {
      // No probability is no answer, as runs read it; never a confident false.
      const { probability } = verdict;
      if (probability === undefined) return instantEvalSkipResultOf("classifier_failed");
      const passed = probability >= BOOLEAN_THRESHOLD;
      const confidence = passed ? probability : 1 - probability;
      return {
        status: "processed",
        passed,
        score: passed ? 1 : 0,
        details: confidenceLine({ answer: String(passed), confidence }),
        cost,
      };
    }
    case "langevals/llm_score": {
      if (verdict.score === undefined) return instantEvalSkipResultOf("classifier_failed");
      const score = scoreOnJudgeRange({ answer: verdict.score, range: judge.settings });
      return {
        status: "processed",
        score,
        details: `Instant Evals: ${roundForDetails(score)}`,
        cost,
      };
    }
    case "langevals/llm_category": {
      // The classifier names the most likely option itself.
      const { label } = verdict;
      if (label === undefined) return instantEvalSkipResultOf("classifier_failed");
      const confidence = verdict.probabilities?.[label] ?? 0;
      return {
        status: "processed",
        label,
        details: confidenceLine({ answer: label, confidence }),
        cost,
      };
    }
  }
}

/**
 * The one place a reason Instant Evals did not judge is worded: skipped, or an error that alerts.
 */
export function instantEvalSkipResultOf(
  reason: InstantEvalJudgeSkipReason,
): SingleEvaluationResult {
  if (SKIPPED_REASONS.has(reason)) {
    return { status: "skipped", details: `Instant Evals skipped this evaluation: ${reason}` };
  }
  return errorResultOf({ code: reason });
}

/** A refused judge call, returned as an error naming its code so it is never read as a skip. */
export function instantEvalRefusalResultOf({
  code,
  message,
}: {
  code: InstantEvalJudgeRefusalCode;
  message: string;
}): SingleEvaluationResult {
  return errorResultOf({ code, message });
}

function errorResultOf({
  code,
  message,
}: {
  code: string;
  message?: string;
}): SingleEvaluationResult {
  const reason = `Instant Evals could not judge this trace: ${code}`;
  return {
    status: "error",
    error_type: code,
    details: message ? `${reason}. ${message}` : reason,
    traceback: [],
  };
}

function confidenceLine({ answer, confidence }: { answer: string; confidence: number }): string {
  return `Instant Evals: ${answer}, ${Math.round(confidence * 100)}% confident`;
}

function roundForDetails(score: number): number {
  return Math.round(score * 100) / 100;
}
