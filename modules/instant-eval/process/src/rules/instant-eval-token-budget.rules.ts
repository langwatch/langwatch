/**
 * How much text one classification may carry: the state cap less the
 * questions less the reserve the answers need.
 * @see modules/instant-eval/specs/classifier.feature
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

/** JSON punctuation shares: at or below the first a transcript, at or above the second JSON. */
const TRANSCRIPT_STRUCTURE_SHARE = 0.08;
const JSON_STRUCTURE_SHARE = 0.15;

/**
 * The ratio a text is fitted at, from how much of it is JSON punctuation: a
 * markdown transcript at the transcript ratio, a JSON-heavy digest at the
 * densest one, and a mix in between. The too-large retry covers a misjudged text.
 */
export function instantEvalFitBytesPerToken({
  text,
  limits = INSTANT_EVAL_CLASSIFIER_LIMITS,
}: {
  text: string;
  limits?: InstantEvalClassifierLimits;
}): number {
  const share = structureShare(text);
  const dense = limits.fitBytesPerInputToken;
  const transcript = limits.transcriptFitBytesPerInputToken;
  if (share <= TRANSCRIPT_STRUCTURE_SHARE) return transcript;
  if (share >= JSON_STRUCTURE_SHARE) return dense;
  const toward =
    (share - TRANSCRIPT_STRUCTURE_SHARE) / (JSON_STRUCTURE_SHARE - TRANSCRIPT_STRUCTURE_SHARE);
  return transcript - (transcript - dense) * toward;
}

/** The share of characters that are JSON punctuation, over a bounded sample. */
function structureShare(text: string): number {
  const sample =
    text.length > STRUCTURE_SAMPLE_CHARS ? text.slice(0, STRUCTURE_SAMPLE_CHARS) : text;
  if (sample.length === 0) return 0;
  let structural = 0;
  for (let i = 0; i < sample.length; i++) {
    if (STRUCTURE_CHARS.has(sample.charCodeAt(i))) structural++;
  }
  return structural / sample.length;
}

const STRUCTURE_CHARS = new Set('{}[]":,'.split("").map((char) => char.charCodeAt(0)));
const STRUCTURE_SAMPLE_CHARS = 200_000;

/**
 * Cuts a text to a budget, keeping both ends, at the ratio its kind measures
 * (markdown transcripts 2.4 bytes per token, JSON-heavy digests 2.0): at the
 * densest ratio for everything, a transcript loses a fifth of the window.
 */
export function prepareInstantEvalText({
  text,
  budgetTokens,
  limits = INSTANT_EVAL_CLASSIFIER_LIMITS,
}: {
  text: string;
  budgetTokens: number;
  limits?: InstantEvalClassifierLimits;
}): PreparedInstantEvalText {
  const bytesPerToken = instantEvalFitBytesPerToken({ text, limits });
  if (new TextEncoder().encode(text).length <= Math.floor(budgetTokens * bytesPerToken)) {
    return { text, isTruncated: false };
  }
  return {
    text: cutToEstimatedTokensKeepingEnds({ text, maxTokens: budgetTokens, bytesPerToken }),
    isTruncated: true,
  };
}

/**
 * The text cut again after the judge refused it as too large: to the budget
 * at a ratio below any judged text measured, or to three quarters of its
 * length when that is shorter, so the retry always sends less.
 */
export function cutInstantEvalTextForRetry({
  text,
  budgetTokens,
  limits = INSTANT_EVAL_CLASSIFIER_LIMITS,
}: {
  text: string;
  budgetTokens: number;
  limits?: InstantEvalClassifierLimits;
}): string {
  const bytesPerToken = limits.retryBytesPerInputToken;
  const threeQuarters =
    (new TextEncoder().encode(text).length * TOO_LARGE_RETRY_FRACTION) / bytesPerToken;
  return cutToEstimatedTokensKeepingEnds({
    text,
    maxTokens: Math.floor(Math.min(budgetTokens, threeQuarters)),
    bytesPerToken,
  });
}

/** The most of a refused text the retry keeps. */
const TOO_LARGE_RETRY_FRACTION = 0.75;

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
