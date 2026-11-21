/**
 * Every ceiling an Instant Eval run is bounded by, in one place.
 *
 * @see modules/instant-eval/specs/instant-eval-api.feature
 */

import type { Instant } from "@langwatch/time";

/** Rows a run judges when the caller asks for no particular number. */
export const INSTANT_EVAL_DEFAULT_ROW_CAP = 10_000;

/** Rows a run may judge at most, on any plan. */
export const INSTANT_EVAL_MAX_ROW_CAP = 100_000;

/** Rows a sample re-reads at most. */
export const INSTANT_EVAL_SAMPLE_CEILING = 25;

/** Judgements one results page carries at most. */
export const INSTANT_EVAL_RESULTS_CEILING = 1_000;

/** Questions one shorthand may ask. */
export const INSTANT_EVAL_MAX_SHORTHAND_QUESTIONS = 10;

/** How far back a shorthand looks when the caller names no window. */
export const INSTANT_EVAL_DEFAULT_WINDOW_DAYS = 7;

/**
 * The token budget the bounded extraction functions are called with: a typical
 * trace renders well under it, and cutting at the classifier's own ceiling
 * instead costs four times as much on the rows least worth reading in full.
 */
export const INSTANT_EVAL_SHORTHAND_TEXT_BUDGET = 8_000;

/** What one judged row is. */
export const INSTANT_EVAL_TARGETS = ["traces", "threads", "llm_spans"] as const;

export type InstantEvalTarget = (typeof INSTANT_EVAL_TARGETS)[number];

/**
 * The parameter a resolved selection is bound under, used when the filter
 * names a field the trace view cannot answer: ten thousand ids are a bound
 * value rather than a statement.
 */
export const INSTANT_EVAL_SELECTION_PARAMETER = "instant_eval_selection_ids";

/** The flag that releases Instant Evals to a project. */
export const INSTANT_EVALS_FLAG = "release_instant_evals";

/** The flag that keeps a project's Instant Evals results and recalls them (ADR-189). */
export const INSTANT_EVAL_RESULTS_FLAG = "release_instant_eval_results";

/** The sources a trace's drawer shows a kept result from; a monitor's shows from its own runs. */
export const INSTANT_EVAL_TRACE_RESULT_SOURCES = ["ask", "run", "dashboard"] as const;

export type InstantEvalTraceResultSource = (typeof INSTANT_EVAL_TRACE_RESULT_SOURCES)[number];

/**
 * The longest trace window the drawer's results read spans from the trace's start, so no caller
 * widens it past partition pruning; a longer trace shows what was kept within this of its start.
 */
export const INSTANT_EVAL_TRACE_RESULTS_MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Who asked for a kept judgement (ADR-189): a provenance label only, which recall never reads. */
export const INSTANT_EVAL_RESULT_SOURCES = [
  ...INSTANT_EVAL_TRACE_RESULT_SOURCES,
  "monitor",
] as const;

export type InstantEvalResultSource = (typeof INSTANT_EVAL_RESULT_SOURCES)[number];

/**
 * How long a monitor waits on eval_results for one recall or one write (ADR-189 section 5); past
 * it, the monitor judges or moves on as it would without the table.
 */
export const EVAL_RESULTS_MONITOR_TIMEOUT_MS = 300;

/** Whether a judgement was made, declined, or attempted and lost. */
export const INSTANT_EVAL_JUDGMENT_STATUSES = ["judged", "skipped", "failed"] as const;

export type InstantEvalJudgmentStatus = (typeof INSTANT_EVAL_JUDGMENT_STATUSES)[number];

/** Where a run is in its life, as every surface reads it. */
export const INSTANT_EVAL_RUN_STATUSES = [
  "queued",
  "planning",
  "running",
  "finished",
  "failed",
  "cancelled",
] as const;

export type InstantEvalRunStatus = (typeof INSTANT_EVAL_RUN_STATUSES)[number];

/** Whether the run is still judging, so a client keeps polling. */
export function isInstantEvalRunActive(status: InstantEvalRunStatus): boolean {
  return status === "queued" || status === "planning" || status === "running";
}

/**
 * How far past its last write a run's judgements may still land, and how far
 * before its acceptance one could have been written: clock skew between the
 * service that accepted the run and the worker that judged it.
 */
const INSTANT_EVAL_WRITE_SKEW_HOURS = 1;

/** A run's written window for a reader of writes another process made, widened by that skew. */
export function instantEvalSkewedWrittenWindow(
  row: Readonly<{ createdAt: Instant; finishedAt: Instant | null }>,
  now: Instant,
): { readonly writtenFrom: Instant; readonly writtenUntil: Instant } {
  return {
    writtenFrom: row.createdAt.subtract({ hours: INSTANT_EVAL_WRITE_SKEW_HOURS }),
    writtenUntil: (row.finishedAt ?? now).add({ hours: INSTANT_EVAL_WRITE_SKEW_HOURS }),
  };
}
