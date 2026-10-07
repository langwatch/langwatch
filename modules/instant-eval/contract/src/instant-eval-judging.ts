/**
 * One synchronous query's judged columns. What a judge is asked and answers
 * lives in the judge's own contract, `@langwatch/instant-eval-judge-contract`.
 *
 * @see modules/instant-eval/specs/classifier.feature
 */

import type { LangWatchQLJudgementCall } from "@langwatch/analytics-contract";
import type { InstantEvalSkipReason } from "@langwatch/instant-eval-judge-contract";

/** One synchronous query's judged columns, their texts in place, and its caller's request. */
export interface InstantEvalQueryJudgingInput {
  readonly projectId: string;
  readonly judgements: readonly LangWatchQLJudgementCall[];
  readonly rows: readonly Record<string, unknown>[];
  /** The caller's request: a cancel stops judging, keeping and billing what was answered. */
  readonly signal?: AbortSignal;
}

/**
 * One synchronous query's rows, judged: each judged column holds its verdict where its text
 * was. A text the judge skipped is a null cell counted here by reason, not a missing key.
 */
export interface InstantEvalQueryJudging {
  readonly rows: readonly Record<string, unknown>[];
  readonly skipped: Readonly<Partial<Record<InstantEvalSkipReason, number>>>;
  /** Present when the caller's signal stopped the judging, naming the rows left unjudged. */
  readonly cancellation?: { readonly unjudgedRows: readonly number[] };
}
