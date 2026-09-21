/**
 * Every ceiling an Instant Eval run is bounded by, in one place.
 *
 * @see specs/instant-evals/instant-eval-api.feature
 */

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

/** The parameters the shorthand binds its resolved window under. */
export const INSTANT_EVAL_WINDOW_PARAMETERS = ["start_at", "end_at"] as const;

/**
 * The parameter a resolved selection is bound under, used when the filter
 * names a field the trace view cannot answer: ten thousand ids are a bound
 * value rather than a statement.
 */
export const INSTANT_EVAL_SELECTION_PARAMETER = "instant_eval_selection_ids";

/** The request type every Instant Eval spend row carries on `gateway_spend`. */
export const INSTANT_EVAL_REQUEST_TYPE = "instant_eval";

/** The flag that releases Instant Evals to a project. */
export const INSTANT_EVALS_FLAG = "release_instant_evals";

/** What the judge takes, and what it answers with. */
export interface InstantEvalClassifierLimits {
  /** Text and questions together may not exceed this. */
  readonly stateTokens: number;
  readonly totalTokens: number;
  readonly maxCategoryOptions: number;
  readonly maxScoreLevels: number;
  /** Covers the envelope and the space the answers need. */
  readonly reserveTokens: number;
  /** Transcripts tokenise denser than prose; measured, not the generic four. */
  readonly bytesPerInputToken: number;
}

/** The shipped classifier's caps, measured against the live API. */
export const INSTANT_EVAL_CLASSIFIER_LIMITS: InstantEvalClassifierLimits = {
  stateTokens: 32_000,
  totalTokens: 64_000,
  maxCategoryOptions: 255,
  maxScoreLevels: 10,
  reserveTokens: 768,
  bytesPerInputToken: 2.7,
};

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
