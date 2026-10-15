/**
 * How much text one classification may carry: the state cap less the
 * questions less the reserve the answers need.
 * @see modules/instant-eval/specs/classifier.feature
 */

import { toClassifierQuestions } from "./instant-eval-classifier-wire.ts";
import {
  INSTANT_EVAL_CLASSIFIER_LIMITS,
  type InstantEvalClassifierLimits,
  type InstantEvalQuestion,
} from "./instant-eval-judge.api.ts";

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

/**
 * The budget a thread transcript is rendered under, in the transcript
 * renderer's own four-bytes ruler, so the rendered text fills the judge's
 * text budget at the transcript ratio and reaches it without a blind cut.
 */
export function instantEvalTranscriptRenderTokens({
  textBudgetTokens,
  limits = INSTANT_EVAL_CLASSIFIER_LIMITS,
}: {
  textBudgetTokens: number;
  limits?: InstantEvalClassifierLimits;
}): number {
  return Math.floor((textBudgetTokens * limits.transcriptFitBytesPerInputToken) / 4);
}
