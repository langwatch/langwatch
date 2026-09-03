import type { CheckPreconditionRule } from "@langwatch/evaluator-web/server/evaluations/types";
import type { PreconditionField } from "@langwatch/analytics-contract";
import { availableFilters } from "./registry";
import type { FilterField } from "./types";

/**
 * Which precondition RULES a field accepts, and what to call it on screen.
 *
 * The field-resolution half of this module moved to
 * `@langwatch/analytics-contract`, where a background process can reach it.
 * What stays here is the half that only a browser asks: the rule set an
 * editor offers per field, and the label it shows, which is read out of the
 * filter registry so the precondition editor and the filter sidebar name the
 * same field the same way.
 */

// ---------------------------------------------------------------------------
// Allowed rules per field
// ---------------------------------------------------------------------------

const TEXT_RULES: CheckPreconditionRule[] = ["is", "contains", "not_contains", "matches_regex"];
const BOOLEAN_RULES: CheckPreconditionRule[] = ["is"];
const ENUM_RULES: CheckPreconditionRule[] = ["is"];
const ARRAY_RULES: CheckPreconditionRule[] = ["is", "contains", "not_contains"];
const EMPTY_RULES: CheckPreconditionRule[] = [];

/**
 * Allowed precondition rules per field.
 * Fields with empty arrays cannot be used as preconditions.
 */
export const PRECONDITION_ALLOWED_RULES: Record<PreconditionField, CheckPreconditionRule[]> = {
  // Precondition-only text fields
  input: TEXT_RULES,
  output: TEXT_RULES,

  // Trace fields
  "traces.origin": ENUM_RULES,
  "traces.error": BOOLEAN_RULES,
  "traces.name": EMPTY_RULES, // analytics-only, not usable as precondition

  // Metadata fields
  "metadata.user_id": TEXT_RULES,
  "metadata.thread_id": TEXT_RULES,
  "metadata.customer_id": TEXT_RULES,
  "metadata.labels": ARRAY_RULES,
  "metadata.prompt_ids": ARRAY_RULES,
  "metadata.key": EMPTY_RULES, // key selector
  "metadata.value": TEXT_RULES,

  // Span fields
  "spans.type": ENUM_RULES,
  "spans.model": ENUM_RULES,

  // Topic fields
  "topics.topics": ARRAY_RULES,
  "topics.subtopics": ARRAY_RULES,

  // Evaluation fields — not usable as preconditions
  "evaluations.evaluator_id": EMPTY_RULES,
  "evaluations.evaluator_id.guardrails_only": EMPTY_RULES,
  "evaluations.evaluator_id.has_passed": EMPTY_RULES,
  "evaluations.evaluator_id.has_score": EMPTY_RULES,
  "evaluations.evaluator_id.has_label": EMPTY_RULES,
  "evaluations.passed": EMPTY_RULES,
  "evaluations.score": EMPTY_RULES, // numeric
  "evaluations.state": EMPTY_RULES,
  "evaluations.label": EMPTY_RULES,

  // Event fields — fetched on demand
  "events.event_type": ENUM_RULES,
  "events.metrics.key": ENUM_RULES, // requires event_type key
  "events.metrics.value": EMPTY_RULES, // numeric
  "events.event_details.key": ENUM_RULES, // requires event_type key

  // Annotation fields
  "annotations.hasAnnotation": BOOLEAN_RULES,
};

/** Labels for precondition-only fields not in the filter registry */
const EXTRA_FIELD_LABELS: Partial<Record<PreconditionField, string>> = {
  input: "Input",
  output: "Output",
};

/**
 * Returns fields that can be used as preconditions (non-empty allowed rules),
 * with their human-readable label from the filter registry.
 */
export function getAvailablePreconditionFields(): {
  field: PreconditionField;
  label: string;
  allowedRules: CheckPreconditionRule[];
}[] {
  return (
    Object.entries(PRECONDITION_ALLOWED_RULES) as [PreconditionField, CheckPreconditionRule[]][]
  )
    .filter(([, rules]) => rules.length > 0)
    .map(([field, rules]) => ({
      field,
      label: getFieldLabel(field),
      allowedRules: rules,
    }));
}

/**
 * Returns the human-readable label for a precondition field.
 */
export function getFieldLabel(field: PreconditionField): string {
  const extraLabel = EXTRA_FIELD_LABELS[field];
  if (extraLabel) return extraLabel;

  // Look up in the filter registry
  const filterDef = availableFilters[field as FilterField];
  if (filterDef) return filterDef.name;

  return field;
}
