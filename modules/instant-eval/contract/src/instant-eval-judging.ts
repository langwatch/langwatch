/**
 * One synchronous query's judged columns. What a judge is asked and answers
 * lives in the judge's own contract, `@langwatch/instant-eval-judge-contract`.
 *
 * @see modules/instant-eval/specs/classifier.feature
 */

import type { LangWatchQLJudgementCall } from "@langwatch/analytics-contract";
import {
  instantEvalTextBudget,
  instantEvalTranscriptRenderTokens,
  type InstantEvalClassifierLimits,
  type InstantEvalQuestion,
  type InstantEvalSkipReason,
} from "@langwatch/instant-eval-judge-contract";

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

/** One judged column's question, addressed to the judge by the column it comes back in. */
export function toInstantEvalQuestion(call: LangWatchQLJudgementCall): InstantEvalQuestion {
  const { column: id, instructions } = call;
  if (call.kind === "score") return { id, kind: "score", instructions, range: call.range };
  if (call.kind === "category") {
    return { id, kind: "category", instructions, options: call.options };
  }

  return {
    id,
    kind: "boolean",
    instructions,
    ...(call.criteria ? { criteria: call.criteria } : {}),
  };
}

/** How large a conversation the judge takes whole, and the budget it is re-rendered under. */
export interface InstantEvalTranscriptFit {
  /** UTF-8 bytes the judge takes uncut, at its own transcript ratio. */
  readonly maxBytes: number;
  /** The same budget in the transcript renderer's four-bytes ruler. */
  readonly renderTokens: number;
}

/**
 * What one conversation judged by these columns may hold under the judge's own limits (Alex,
 * 2026-10-08, round 26 CD-4); undefined when the questions leave no text, which `judgeQuery`
 * refuses.
 */
export function computeInstantEvalTranscriptFit({
  judgements,
  limits,
}: {
  judgements: readonly LangWatchQLJudgementCall[];
  limits: InstantEvalClassifierLimits;
}): InstantEvalTranscriptFit | undefined {
  const questions = judgements.map(toInstantEvalQuestion);
  const textBudgetTokens = instantEvalTextBudget({ questions, limits });
  if (textBudgetTokens <= 0) return undefined;

  return {
    maxBytes: Math.floor(textBudgetTokens * limits.transcriptFitBytesPerInputToken),
    renderTokens: Math.max(1, instantEvalTranscriptRenderTokens({ textBudgetTokens, limits })),
  };
}
