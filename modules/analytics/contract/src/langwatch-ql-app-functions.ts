/**
 * LangWatchQL app functions: a name whose value the application computes
 * rather than the database. Only the portable half lives here.
 * @see specs/lwql/app-functions.feature
 */

/** An option literal, which must be a literal so the plan is the statement's. */
export type LangWatchQLAppFunctionOption = string | number | readonly string[];

/** One app-function call the validator read off a statement's projection. */
export interface LangWatchQLAppFunctionCall {
  /** The output column the caller aliased the call to. */
  readonly column: string;
  readonly function: string;
  /** The literal options, in the order the function declares them. */
  readonly options: readonly LangWatchQLAppFunctionOption[];
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
