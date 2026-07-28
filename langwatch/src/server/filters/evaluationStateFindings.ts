import { findOffendingEvaluationStateEntries } from "./types";

/** The exact filter key this scan applies to — an exact match, never a
 *  `startsWith("evaluations.")` prefix, so `evaluations.label` and every
 *  other filter field are left alone even when they hold the same
 *  offending string. */
const EVALUATIONS_STATE_FIELD = "evaluations.state" as const;

export type StateFinding = {
  evaluatorKey: string;
  offendingValue: string;
  action: "reported_unmappable" | "reported_malformed";
};

/**
 * Scans a filters blob for `evaluations.state` values that fall outside the
 * canonical execution-state domain — derived (via
 * `findOffendingEvaluationStateEntries`) from
 * `evaluationRunDataSchema.shape.status.options`, never a hand-written
 * literal, since that drift is the exact defect filed as #6296.
 *
 * Report-only: this never mutates or rejects anything, it just tells a
 * caller (the repair/migration job) what it would need to fix. One finding
 * per (evaluatorKey, offendingValue) pair.
 *
 * Total: any input that isn't a usable filters object — `null`, an array, a
 * primitive — yields `[]` rather than throwing.
 */
export function findNonCanonicalStateValues(filters: unknown): StateFinding[] {
  if (typeof filters !== "object" || filters === null || Array.isArray(filters)) {
    return [];
  }

  const stateValue = (filters as Record<string, unknown>)[
    EVALUATIONS_STATE_FIELD
  ];

  return findOffendingEvaluationStateEntries(stateValue).map(
    ({ evaluatorKey, offendingValue }) => ({
      evaluatorKey,
      offendingValue,
      action: "reported_unmappable" as const,
    }),
  );
}
