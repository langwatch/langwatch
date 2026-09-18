/**
 * How much text one classification may carry.
 *
 * The classifier's state cap covers the text **and** the questions together,
 * which is measured rather than read off the name: 33,000 estimated tokens of
 * text alone is accepted, while 31,000 of text beside a five-thousand-token
 * question payload is refused with `max_tokens_exceeded`. So the text budget is
 * arithmetic on what the questions leave:
 *
 * ```
 * text budget = state cap − questions − reserve
 * ```
 *
 * The reserve covers the envelope and the space the answers need. It is a flat
 * number rather than a computation because the alternative is estimating the
 * size of an answer that has not been given yet, and being wrong there costs a
 * refused request for every row of a query.
 *
 * The estimate is the shared bytes-over-four rule
 * (`~/shared/traces/tokenBudget`), the same one the extraction functions cut
 * with, so a conversation rendered to fit a budget is not re-measured by a
 * different ruler here.
 *
 * @see ./classifier.ts
 * @see ../../../../../specs/instant-evals/classifier.feature
 */

import {
  cutToEstimatedTokens,
  estimateTokensFromBytes,
} from "~/shared/traces/tokenBudget";
import type {
  InstantEvalClassifierLimits,
  InstantEvalQuestion,
} from "./classifier";
import { instantEvalScoreLevels, toClassifierQuestions } from "./questions";

/** The shipped classifier's caps, measured against the live API in September 2026. */
export const INSTANT_EVAL_CLASSIFIER_LIMITS: InstantEvalClassifierLimits = {
  stateTokens: 32_000,
  totalTokens: 64_000,
  maxCategoryOptions: 255,
  maxScoreLevels: 10,
  reserveTokens: 768,
};

/** Estimated tokens the questions themselves occupy. */
export function instantEvalQuestionTokens(
  questions: readonly InstantEvalQuestion[],
): number {
  return estimateTokensFromBytes(
    JSON.stringify(toClassifierQuestions(questions)),
  );
}

/**
 * Tokens of text these questions leave room for, or `null` when they leave
 * none.
 *
 * `null` rather than zero, and rather than a throw: a question list this large
 * is the caller's own statement and has to be refused before a request is
 * built, but the refusal belongs to whoever has the caller's words — sending an
 * empty text instead would spend money on a judgement of nothing.
 */
export function instantEvalTextBudget({
  questions,
  limits = INSTANT_EVAL_CLASSIFIER_LIMITS,
}: {
  questions: readonly InstantEvalQuestion[];
  limits?: InstantEvalClassifierLimits;
}): number | null {
  const budget =
    limits.stateTokens -
    instantEvalQuestionTokens(questions) -
    limits.reserveTokens;
  return budget > 0 ? budget : null;
}

/** The text as it will be sent, and whether fitting it cost anything. */
export interface PreparedInstantEvalText {
  readonly text: string;
  readonly isTruncated: boolean;
}

/** Cuts a text to a budget, on a character boundary. */
export function prepareInstantEvalText({
  text,
  budgetTokens,
}: {
  text: string;
  budgetTokens: number;
}): PreparedInstantEvalText {
  if (estimateTokensFromBytes(text) <= budgetTokens) {
    return { text, isTruncated: false };
  }
  return {
    text: cutToEstimatedTokens({ text, maxTokens: budgetTokens }),
    isTruncated: true,
  };
}

/**
 * What one classification is expected to cost in input tokens.
 *
 * Used before anything is sent, to decide whether a whole query is affordable.
 * It counts the text as it will be after the cut, so a query over enormous
 * conversations is estimated at what it will really send rather than at what it
 * holds.
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
  const textTokens = Math.min(
    estimateTokensFromBytes(text),
    Math.max(0, budget),
  );
  return textTokens + questionTokens;
}

/**
 * Whether a category question offers more options than the classifier takes.
 *
 * Asked by the validator, so the refusal names the statement's own words rather
 * than arriving from the provider as a failed request per row.
 */
export function exceedsCategoryOptionLimit({
  options,
  limits = INSTANT_EVAL_CLASSIFIER_LIMITS,
}: {
  options: number;
  limits?: InstantEvalClassifierLimits;
}): boolean {
  return options > limits.maxCategoryOptions;
}

/** How many levels a score range would ask the classifier to weigh. */
export function instantEvalScoreLevelCount(range: {
  min: number;
  max: number;
}): number {
  return instantEvalScoreLevels({
    id: "range",
    kind: "score",
    instructions: "range",
    range,
  }).length;
}
