/**
 * How a text is cut to fit the classifier, keeping both ends, and cut again after a too-large
 * refusal. The cloud classifier client's own rule (ADR-174 decision 13).
 * @see modules/instant-eval/specs/classifier.feature
 */

import {
  INSTANT_EVAL_CLASSIFIER_LIMITS,
  type InstantEvalClassifierLimits,
} from "@langwatch/instant-eval-judge-contract";
import { cutToEstimatedTokensKeepingEnds } from "@langwatch/trace-contract";

/** The text as it will be sent, and whether fitting it cost anything. */
interface PreparedInstantEvalText {
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
function instantEvalFitBytesPerToken({
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
