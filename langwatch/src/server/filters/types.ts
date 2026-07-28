import { z } from "zod";

import { evaluationRunDataSchema } from "~/server/app-layer/evaluations/types";

export const filterFieldsEnum = z.enum([
  "topics.topics",
  "topics.subtopics",
  "metadata.user_id",
  "metadata.thread_id",
  "metadata.customer_id",
  "metadata.labels",
  "metadata.key",
  "metadata.value",
  "metadata.prompt_ids",
  "traces.origin",
  "traces.error",
  "traces.name",
  "spans.type",
  "spans.model",
  "evaluations.evaluator_id",
  "evaluations.evaluator_id.guardrails_only",
  "evaluations.evaluator_id.has_passed",
  "evaluations.evaluator_id.has_score",
  "evaluations.evaluator_id.has_label",
  "evaluations.passed",
  "evaluations.score",
  "evaluations.state",
  "evaluations.label",
  "events.event_type",
  "events.metrics.key",
  "events.metrics.value",
  "events.event_details.key",
  "annotations.hasAnnotation",
]);

export type FilterField = z.infer<typeof filterFieldsEnum>;

// Schema for trigger filter values - can be nested up to 2 levels deep
const filterValueSchema: z.ZodType<
  string[] | Record<string, string[]> | Record<string, Record<string, string[]>>
> = z.lazy(() =>
  z.union([
    z.array(z.string()),
    z.record(z.string(), z.array(z.string())),
    z.record(z.string(), z.record(z.string(), z.array(z.string()))),
  ]),
);

export type TriggerFilterValue = z.infer<typeof filterValueSchema>;
export type TriggerFilters = Partial<Record<FilterField, TriggerFilterValue>>;

/**
 * The exact filter key the execution-state value domain below applies to.
 * `filterValueSchema` above is field-agnostic and shared by every filter
 * field, so the domain check keys on this literal constant — an exact
 * match, never a `startsWith("evaluations.")` prefix — so it can never widen
 * to also constrain `evaluations.label` or any other field.
 */
const EVALUATIONS_STATE_FIELD = "evaluations.state" as const;

/**
 * The canonical execution-state domain for `evaluations.state`, mirrored
 * from `EvaluationRunData.status` rather than hand-copied (#4805, #6296): an
 * added/removed status fails here instead of silently drifting out of sync
 * with what the trigger matcher actually compares against
 * (`triggerFilter.matcher.ts`'s `evaluations.some((e) =>
 * values.includes(e.status))`).
 */
const CANONICAL_EVALUATION_STATE_VALUES = new Set<string>(
  evaluationRunDataSchema.shape.status.options,
);

export type EvaluationStateOffense = {
  evaluatorKey: string;
  offendingValue: string;
};

/**
 * Walks an already-extracted `evaluations.state` filter value
 * (`{ [evaluatorId]: string[] }`) and returns one entry per stored string
 * that falls outside the canonical execution-state domain. Anything that
 * isn't that per-evaluator-array shape (missing, a bare array, wrong
 * nesting) yields `[]` rather than throwing — an unreadable shape is
 * "nothing to flag" here, not a crash.
 *
 * Single source of truth for the domain check: the schema guard below,
 * `sanitizeTriggerFilters`, `findNonCanonicalStateValues`
 * (`evaluationStateFindings.ts`), and the trigger repository's write-path
 * guard all call this instead of re-deriving the canonical set or
 * re-walking the shape themselves.
 */
export function findOffendingEvaluationStateEntries(
  evaluationStateValue: unknown,
): EvaluationStateOffense[] {
  if (
    typeof evaluationStateValue !== "object" ||
    evaluationStateValue === null ||
    Array.isArray(evaluationStateValue)
  ) {
    return [];
  }

  const offenses: EvaluationStateOffense[] = [];
  for (const [evaluatorKey, states] of Object.entries(
    evaluationStateValue as Record<string, unknown>,
  )) {
    if (!Array.isArray(states)) continue;
    for (const state of states) {
      if (
        typeof state === "string" &&
        !CANONICAL_EVALUATION_STATE_VALUES.has(state)
      ) {
        offenses.push({ evaluatorKey, offendingValue: state });
      }
    }
  }
  return offenses;
}

/**
 * Rejects a filters record whose `evaluations.state` entry names a value
 * outside the canonical domain. Attached via `.superRefine` (rather than
 * narrowing `filterValueSchema` itself) so the constraint applies to this
 * one field without touching the shared, field-agnostic value schema every
 * other filter field also uses.
 */
function rejectNonCanonicalEvaluationState(
  filters: object,
  ctx: z.RefinementCtx,
): void {
  const record = filters as Record<string, unknown>;
  const offenses = findOffendingEvaluationStateEntries(
    record[EVALUATIONS_STATE_FIELD],
  );
  for (const { evaluatorKey, offendingValue } of offenses) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `"${offendingValue}" is not a canonical evaluation execution state (evaluations.state.${evaluatorKey}). Valid values: ${[...CANONICAL_EVALUATION_STATE_VALUES].join(", ")}.`,
      path: [EVALUATIONS_STATE_FIELD, evaluatorKey],
    });
  }
}

// Schema for validating trigger filter JSON structure — rejects unknown fields
export const triggerFiltersSchema = z
  .record(filterFieldsEnum, filterValueSchema)
  .superRefine(rejectNonCanonicalEvaluationState);

/** Validates filter value structure without restricting field names. */
export const triggerFiltersPermissiveSchema = z
  .record(z.string(), filterValueSchema)
  .superRefine(rejectNonCanonicalEvaluationState);

const validFilterFields = new Set<string>(filterFieldsEnum.options);

const isTriggerFilterField = (field: string): field is FilterField =>
  validFilterFields.has(field);

/**
 * Rebuilds an `evaluations.state` filter value with every non-canonical
 * entry removed, using the same walk as `findOffendingEvaluationStateEntries`
 * so "what counts as offending" can never drift between detection and
 * sanitization. Returns `null` once nothing canonical remains, so the caller
 * drops the key entirely instead of persisting an empty stub.
 */
function dropOffendingEvaluationStateEntries(
  value: TriggerFilterValue,
): TriggerFilterValue | null {
  const offenses = findOffendingEvaluationStateEntries(value);
  if (offenses.length === 0) return value;

  const offendingByEvaluator = new Map<string, Set<string>>();
  for (const { evaluatorKey, offendingValue } of offenses) {
    const set = offendingByEvaluator.get(evaluatorKey) ?? new Set<string>();
    set.add(offendingValue);
    offendingByEvaluator.set(evaluatorKey, set);
  }

  // `offenses` is only ever non-empty for the per-evaluator
  // `{ [evaluatorId]: string[] }` shape (see
  // findOffendingEvaluationStateEntries), so this cast is safe.
  const cleaned: Record<string, string[]> = {};
  for (const [evaluatorKey, states] of Object.entries(
    value as Record<string, string[]>,
  )) {
    const offending = offendingByEvaluator.get(evaluatorKey);
    const kept = offending
      ? states.filter((state) => !offending.has(state))
      : states;
    if (kept.length > 0) cleaned[evaluatorKey] = kept;
  }

  return Object.keys(cleaned).length > 0 ? cleaned : null;
}

export const sanitizeTriggerFilters = (
  filters: Record<string, TriggerFilterValue>,
) => {
  const sanitized: TriggerFilters = {};
  const unknownFields: string[] = [];

  for (const [key, value] of Object.entries(filters)) {
    if (!isTriggerFilterField(key)) {
      unknownFields.push(key);
      continue;
    }

    if (key === EVALUATIONS_STATE_FIELD) {
      const cleaned = dropOffendingEvaluationStateEntries(value);
      if (cleaned !== null) sanitized[key] = cleaned;
      continue;
    }

    sanitized[key] = value;
  }

  return { sanitized, unknownFields };
};

export type FilterDefinition = {
  name: string;
  urlKey: string;
  single?: boolean;
  type?: "numeric";
  requiresKey?: {
    filter: FilterField;
  };
  requiresSubkey?: {
    filter: FilterField;
  };
};
