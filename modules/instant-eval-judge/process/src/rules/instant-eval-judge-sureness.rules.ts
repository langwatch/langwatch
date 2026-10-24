/**
 * How sure one routed answer is, from 0 (a coin toss) to 1 (certain), per question kind: the
 * number an escalation threshold and a pair's pick compare. Yes or no is |2p - 1|; a score reads
 * its spread against half the range; a category its top option against the runner-up.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import type {
  InstantEvalCategoryQuestion,
  InstantEvalJudgeSurenessRule,
  InstantEvalQuestion,
  InstantEvalScoreQuestion,
  InstantEvalVerdict,
} from "@langwatch/instant-eval-judge-contract";

/**
 * A decision model's answer's sureness. An answer with nothing to read it from (no probability,
 * no distribution) is zero, the least sure, so it always escalates.
 */
export function instantEvalVerdictSurenessOf({
  question,
  verdict,
  rule,
}: {
  question: InstantEvalQuestion;
  verdict: InstantEvalVerdict;
  rule: InstantEvalJudgeSurenessRule | undefined;
}): number {
  if (question.kind === "boolean") {
    return verdict.probability === undefined ? 0 : Math.abs(2 * verdict.probability - 1);
  }
  if (question.kind === "score") return scoreSureness({ question, verdict });
  return categorySureness({ question, verdict, rule: rule === "top" ? "top" : "margin" });
}

/** One level is certain; the widest spread a range allows, half at each end, is a coin toss. */
function scoreSureness({
  question,
  verdict,
}: {
  question: InstantEvalScoreQuestion;
  verdict: InstantEvalVerdict;
}): number {
  const halfRange = (question.range.max - question.range.min) / 2;
  if (halfRange <= 0) return 1;
  if (verdict.spread === undefined) return 0;
  return clampToUnit(1 - verdict.spread / halfRange);
}

/** Over the offered options only, renormalised, so a stray name never lowers the margin. */
function categorySureness({
  question,
  verdict,
  rule,
}: {
  question: InstantEvalCategoryQuestion;
  verdict: InstantEvalVerdict;
  rule: "margin" | "top";
}): number {
  const { probabilities } = verdict;
  if (!probabilities) return 0;
  const offered = question.options
    .map((option) => probabilities[option.name] ?? 0)
    .toSorted((a, b) => b - a);
  const total = offered.reduce((sum, p) => sum + p, 0);
  if (total <= 0) return 0;
  const top = (offered[0] ?? 0) / total;
  if (rule === "top") return clampToUnit(top);
  return clampToUnit(top - (offered[1] ?? 0) / total);
}

function clampToUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Unsure below the threshold. */
export function isUnsureAnswer({
  sureness,
  threshold,
}: {
  sureness: number;
  threshold: number;
}): boolean {
  return sureness < threshold;
}

/** What an LLM leg said about one question, before it is a verdict. */
export type InstantEvalLlmJudgeValue =
  | Readonly<{ verdict: boolean }>
  | Readonly<{ score: number }>
  | Readonly<{ label: string }>;

/**
 * An LLM's answer as the verdict a decision model would give, or none when it answered in
 * another kind's field: yes or no as P(yes) of one or zero, a score as itself, a category as its
 * label with all the probability on it. An LLM gives no distribution, so it is taken as sure.
 */
export function findInstantEvalLlmVerdicts({
  question,
  value,
}: {
  question: InstantEvalQuestion;
  value: InstantEvalLlmJudgeValue;
}): InstantEvalVerdict[] {
  const questionId = question.id;
  if (question.kind === "boolean") {
    return "verdict" in value ? [{ questionId, probability: value.verdict ? 1 : 0 }] : [];
  }
  if (question.kind === "score") {
    return "score" in value ? [{ questionId, score: value.score }] : [];
  }
  if (!("label" in value)) return [];
  const probabilities = Object.fromEntries(
    question.options.map((option) => [option.name, option.name === value.label ? 1 : 0]),
  );
  return [{ questionId, label: value.label, probabilities }];
}
