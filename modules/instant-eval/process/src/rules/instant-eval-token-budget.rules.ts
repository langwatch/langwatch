/**
 * How much text one classification may carry: the state cap less the
 * questions less the reserve the answers need.
 * @see specs/instant-evals/classifier.feature
 */

import {
  INSTANT_EVAL_CLASSIFIER_LIMITS,
  type InstantEvalClassifierLimits,
  type InstantEvalQuestion,
} from "@langwatch/instant-eval-contract";
import { cutToEstimatedTokensKeepingEnds } from "@langwatch/trace-contract";

import { instantEvalScoreLevels, toClassifierQuestions } from "./instant-eval-judge-wire.rules.ts";

/**
 * Estimated tokens in a string, from its UTF-8 byte length. Deliberately not
 * a real tokenizer: loading one costs more than the budget it protects, and
 * byte length is never wildly low for CJK or emoji.
 */
export function estimateTokensFromBytes(text: string): number {
  return Math.ceil(new TextEncoder().encode(text).length / 4);
}

/**
 * Estimated input tokens in a piece of judged text. Not the generic rule of
 * four: that is calibrated on English prose, and a run judges markdown
 * transcripts, which measure 2.4 to 2.7 bytes per token against the live API.
 */
export function estimateJudgedTextTokens({
  text,
  limits = INSTANT_EVAL_CLASSIFIER_LIMITS,
}: {
  text: string;
  limits?: InstantEvalClassifierLimits;
}): number {
  const bytes = new TextEncoder().encode(text).length;
  return Math.ceil(bytes / Math.max(0.1, limits.bytesPerInputToken));
}

/** Estimated tokens the questions themselves occupy. */
export function instantEvalQuestionTokens(questions: readonly InstantEvalQuestion[]): number {
  return estimateTokensFromBytes(JSON.stringify(toClassifierQuestions(questions)));
}

/**
 * Tokens of text these questions leave room for; zero when they leave none,
 * which the caller refuses rather than paying for a judgement of nothing.
 */
export function instantEvalTextBudget({
  questions,
  limits = INSTANT_EVAL_CLASSIFIER_LIMITS,
}: {
  questions: readonly InstantEvalQuestion[];
  limits?: InstantEvalClassifierLimits;
}): number {
  const budget = limits.stateTokens - instantEvalQuestionTokens(questions) - limits.reserveTokens;
  return budget > 0 ? budget : 0;
}

/** The text as it will be sent, and whether fitting it cost anything. */
export interface PreparedInstantEvalText {
  readonly text: string;
  readonly isTruncated: boolean;
}

/**
 * Cuts a text to a budget, keeping both ends. Measured with the generic rule
 * rather than the denser one, because the extraction functions cut their
 * `max_tokens` argument by it: a conversation rendered to fit must not be cut twice.
 */
export function prepareInstantEvalText({
  text,
  budgetTokens,
}: {
  text: string;
  budgetTokens: number;
}): PreparedInstantEvalText {
  if (estimateTokensFromBytes(text) <= budgetTokens) return { text, isTruncated: false };
  return {
    text: cutToEstimatedTokensKeepingEnds({ text, maxTokens: budgetTokens }),
    isTruncated: true,
  };
}

/**
 * What one classification is expected to cost in input tokens, counting the
 * text as it will be after the cut.
 */
export function estimateInstantEvalRequestTokens({
  text,
  questions,
  limits = INSTANT_EVAL_CLASSIFIER_LIMITS,
}: {
  text: string;
  questions: readonly InstantEvalQuestion[];
  limits?: InstantEvalClassifierLimits;
}): number {
  const questionTokens = instantEvalQuestionTokens(questions);
  const budget = limits.stateTokens - questionTokens - limits.reserveTokens;
  const textTokens = Math.min(estimateJudgedTextTokens({ text, limits }), Math.max(0, budget));
  return textTokens + questionTokens;
}

/** Whether a category question offers more options than the judge takes. */
export function exceedsCategoryOptionLimit({
  options,
  limits = INSTANT_EVAL_CLASSIFIER_LIMITS,
}: {
  options: number;
  limits?: InstantEvalClassifierLimits;
}): boolean {
  return options > limits.maxCategoryOptions;
}

/** How many levels a score range would ask the judge to weigh. */
export function instantEvalScoreLevelCount(range: { min: number; max: number }): number {
  return instantEvalScoreLevels({ id: "range", kind: "score", instructions: "range", range })
    .length;
}
