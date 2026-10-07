/**
 * Maps an Instant Evals judgement back to the result shape an LLM judge returns today
 * (ADR-174 decisions 3 to 7).
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */

import type { SingleEvaluationResult } from "@langwatch/evaluator-contract";
import type {
  InstantEvalJudgement,
  InstantEvalSkipReason,
} from "@langwatch/instant-eval-judge-contract";

import {
  INSTANT_EVAL_JUDGE_QUESTION_ID,
  scoreOnJudgeRange,
  type InstantEvalJudge,
} from "./instant-eval-judge-question.rules.ts";

/** `passed` on a boolean judge: the probability of true against this. */
const BOOLEAN_THRESHOLD = 0.5;

/** Too large is the trace's own size, not an outage, so it does not fire alerts. */
const SKIPPED_REASONS: ReadonlySet<InstantEvalSkipReason> = new Set(["classifier_input_too_large"]);

export function instantEvalJudgeResult({
  judge,
  judgement,
  priceUsd,
}: {
  judge: InstantEvalJudge;
  judgement: InstantEvalJudgement;
  priceUsd: number;
}): SingleEvaluationResult {
  if (judgement.skippedReason) return skipResultOf(judgement.skippedReason);
  const verdict = judgement.verdicts.find(
    ({ questionId }) => questionId === INSTANT_EVAL_JUDGE_QUESTION_ID,
  );
  if (!verdict) return skipResultOf("classifier_failed");
  const cost = { currency: "USD", amount: priceUsd };

  switch (judge.evaluatorType) {
    case "langevals/llm_boolean": {
      // No probability is no answer, as runs read it; never a confident false.
      const { probability } = verdict;
      if (probability === undefined) return skipResultOf("classifier_failed");
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
      if (verdict.score === undefined) return skipResultOf("classifier_failed");
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
      if (label === undefined) return skipResultOf("classifier_failed");
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

function skipResultOf(reason: InstantEvalSkipReason): SingleEvaluationResult {
  if (SKIPPED_REASONS.has(reason)) {
    return { status: "skipped", details: `Instant Evals skipped this trace: ${reason}` };
  }
  return {
    status: "error",
    error_type: reason,
    details: `Instant Evals could not judge this trace: ${reason}`,
    traceback: [],
  };
}

function confidenceLine({ answer, confidence }: { answer: string; confidence: number }): string {
  return `Instant Evals: ${answer}, ${Math.round(confidence * 100)}% confident`;
}

function roundForDetails(score: number): number {
  return Math.round(score * 100) / 100;
}
