import type { FilterField } from "./types";
import { availableFilters } from "./registry";
import type { CheckPreconditionRule } from "../evaluations/types";

// ---------------------------------------------------------------------------
// PreconditionTraceData — unified trace data for in-memory matching
// ---------------------------------------------------------------------------

/**
 * Unified trace data available for precondition matching.
 * Supports both the legacy collector path (ElasticSearchTrace) and
 * the event-sourcing path (TraceSummaryData fold state + spans).
 */
export interface PreconditionTraceData {
  input?: string | null;
  output?: string | null;
  origin?: string | null;
  hasError?: boolean | null;
  userId?: string | null;
  threadId?: string | null;
  customerId?: string | null;
  labels?: string[] | null;
  promptIds?: string[] | null;
  topicId?: string | null;
  subTopicId?: string | null;
  spanTypes?: string[] | null;
  spanModels?: string[] | null;
  customMetadata?: Record<string, string | null> | null;
  satisfactionScore?: number | null;
  hasAnnotation?: boolean | null;
}

// ---------------------------------------------------------------------------
// PreconditionField — all possible precondition fields
// ---------------------------------------------------------------------------

/** All fields that can be used in preconditions: every FilterField plus input/output */
export type PreconditionField = FilterField | "input" | "output";

// ---------------------------------------------------------------------------
// PreconditionFieldMatcher
// ---------------------------------------------------------------------------

/**
 * Resolves a field value from trace data for precondition evaluation.
 * Returns the resolved value as a string, string array, or null/undefined.
 *
 * @param data - The unified trace data
 * @param value - The precondition value (for context, not used in resolution)
 * @param key - Optional key for nested filters (e.g., metadata key name)
 * @param subkey - Optional subkey for double-nested filters
 */
export type PreconditionFieldMatcher = (
  data: PreconditionTraceData,
  value: string,
  key?: string,
  subkey?: string,
) => string | string[] | null | undefined;

// ---------------------------------------------------------------------------
// Matcher registry — one matcher per PreconditionField
// ---------------------------------------------------------------------------

/**
 * Exhaustive registry mapping each precondition field to its matcher function.
 * Fields set to `null` are key-selector fields or not available at trace
 * arrival time, and cannot be used as standalone precondition values.
 */
export const PRECONDITION_FIELD_MATCHERS: Record<
  PreconditionField,
  PreconditionFieldMatcher | null
> = {
  // Precondition-only fields
  input: (data) => data.input,
  output: (data) => data.output,

  // Trace fields
  "traces.origin": (data) => data.origin || "application",
  "traces.error": (data) =>
    data.hasError != null ? (data.hasError ? "true" : "false") : "false",

  // Metadata fields
  "metadata.user_id": (data) => data.userId,
  "metadata.thread_id": (data) => data.threadId,
  "metadata.customer_id": (data) => data.customerId,
  "metadata.labels": (data) => data.labels,
  "metadata.prompt_ids": (data) => data.promptIds,
  "metadata.key": null, // key selector — not matchable
  "metadata.value": (data, _value, key) =>
    key ? (data.customMetadata?.[key] ?? null) : null,

  // Span fields
  "spans.type": (data) => data.spanTypes,
  "spans.model": (data) => data.spanModels,

  // Topic fields
  "topics.topics": (data) =>
    data.topicId ? [data.topicId] : null,
  "topics.subtopics": (data) =>
    data.subTopicId ? [data.subTopicId] : null,

  // Evaluation fields — not available at trace arrival time
  "evaluations.evaluator_id": null,
  "evaluations.evaluator_id.guardrails_only": null,
  "evaluations.passed": null,
  "evaluations.score": null,
  "evaluations.state": null,
  "evaluations.label": null,

  // Event fields — not available at trace arrival time
  "events.event_type": null,
  "events.metrics.key": null,
  "events.metrics.value": null,
  "events.event_details.key": null,

  // Annotation fields
  "annotations.hasAnnotation": (data) =>
    data.hasAnnotation != null
      ? data.hasAnnotation
        ? "true"
        : "false"
      : null,

};

// ---------------------------------------------------------------------------
// Allowed rules per field
// ---------------------------------------------------------------------------

const TEXT_RULES: CheckPreconditionRule[] = [
  "is",
  "contains",
  "not_contains",
  "matches_regex",
];
const BOOLEAN_RULES: CheckPreconditionRule[] = ["is"];
const ENUM_RULES: CheckPreconditionRule[] = ["is"];
const ARRAY_RULES: CheckPreconditionRule[] = ["is", "contains", "not_contains"];
const EMPTY_RULES: CheckPreconditionRule[] = [];

/**
 * Allowed precondition rules per field.
 * Fields with empty arrays cannot be used as preconditions.
 */
export const PRECONDITION_ALLOWED_RULES: Record<
  PreconditionField,
  CheckPreconditionRule[]
> = {
  // Precondition-only text fields
  input: TEXT_RULES,
  output: TEXT_RULES,

  // Trace fields
  "traces.origin": ENUM_RULES,
  "traces.error": BOOLEAN_RULES,

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
  "evaluations.passed": EMPTY_RULES,
  "evaluations.score": EMPTY_RULES, // numeric
  "evaluations.state": EMPTY_RULES,
  "evaluations.label": EMPTY_RULES,

  // Event fields — not usable as preconditions
  "events.event_type": EMPTY_RULES,
  "events.metrics.key": EMPTY_RULES,
  "events.metrics.value": EMPTY_RULES, // numeric
  "events.event_details.key": EMPTY_RULES,

  // Annotation fields
  "annotations.hasAnnotation": BOOLEAN_RULES,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    Object.entries(PRECONDITION_ALLOWED_RULES) as [
      PreconditionField,
      CheckPreconditionRule[],
    ][]
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
