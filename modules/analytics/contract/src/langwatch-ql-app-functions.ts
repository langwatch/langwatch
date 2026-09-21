/**
 * LangWatchQL app functions: a name whose value the application computes
 * rather than the database. Only the portable half lives here.
 * @see specs/lwql/app-functions.feature
 */

/** An option literal, which must be a literal so the plan is the statement's. */
export type LangWatchQLAppFunctionOption = string | number | readonly string[];

/**
 * The extraction call nested inside an eval call, the usual way to write one.
 * The identity UDFs leave the inner function's key in the column, so hydration
 * runs the extraction first and judges what it produced.
 */
export interface LangWatchQLAppFunctionSource {
  readonly function: string;
  readonly options: readonly LangWatchQLAppFunctionOption[];
}

/** One app-function call the validator read off a statement's projection. */
export interface LangWatchQLAppFunctionCall {
  /** The output column the caller aliased the call to. */
  readonly column: string;
  readonly function: string;
  /** The literal options, in the order the function declares them. */
  readonly options: readonly LangWatchQLAppFunctionOption[];
  /** The extraction call this one judges, for an eval function written over one. */
  readonly source?: LangWatchQLAppFunctionSource;
}

/**
 * Which part of a verdict an eval function's column carries. A judge answers
 * one judgement per question, and each function publishes one reading of it.
 */
export const LWQL_JUDGEMENT_READINGS = [
  "probability",
  "passed",
  "score",
  "label",
  "probabilities",
] as const;

export type LangWatchQLJudgementReading = (typeof LWQL_JUDGEMENT_READINGS)[number];

/**
 * What kind of question an eval function asks. Declared here rather than read
 * from the judging module, because the dependency runs the other way: a judge
 * reads LangWatchQL's vocabulary, never the reverse.
 */
export const LWQL_JUDGEMENT_KINDS = ["boolean", "score", "category"] as const;

export type LangWatchQLJudgementKind = (typeof LWQL_JUDGEMENT_KINDS)[number];

/** How one eval function asks its question and reads its answer. */
export interface LangWatchQLJudgement {
  readonly kind: LangWatchQLJudgementKind;
  readonly reads: LangWatchQLJudgementReading;
}
