import { CADENCE_WINDOW_MS, type NotificationCadence } from "./cadences";
import type { TriggerAction } from "./trigger";

export const NOTIFY_TRIGGER_ACTIONS = new Set<TriggerAction>([
  "SEND_EMAIL",
  "SEND_SLACK_MESSAGE",
  "SEND_WEBHOOK",
]);

export const PERSIST_TRIGGER_ACTIONS = new Set<TriggerAction>([
  "ADD_TO_DATASET",
  "ADD_TO_ANNOTATION_QUEUE",
]);

export function computeScheduledFor(input: {
  action: TriggerAction;
  cadence: NotificationCadence;
  now: Date;
}): Date {
  if (PERSIST_TRIGGER_ACTIONS.has(input.action) || input.cadence === "immediate") {
    return input.now;
  }

  const windowMs = CADENCE_WINDOW_MS[input.cadence];

  return new Date((Math.floor(input.now.getTime() / windowMs) + 1) * windowMs);
}

/**
 * Whether a filter value contains an actual condition.
 *
 * Empty arrays and objects are intentionally vacuous. This is shared by the
 * authoring boundary and runaway containment so legacy rows that predate the
 * authoring guard retain their existing dispatch semantics.
 */
export function hasActionableTriggerFilters(filters: Record<string, unknown>): boolean {
  return Object.values(filters).some(hasActionableFilterValue);
}

function hasActionableFilterValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).some(hasActionableFilterValue);
}

/**
 * Grandfathered trace automations with no narrowing condition match every
 * trace. Alerts, reports, and graph-backed automations have their condition
 * elsewhere and must never be classified as this shape.
 */
export function isMatchEverythingTrigger(trigger: {
  triggerKind: string;
  customGraphId: string | null;
  filterQuery: string | null;
  filters: Record<string, unknown>;
}): boolean {
  if (trigger.triggerKind !== "AUTOMATION") return false;
  if (trigger.customGraphId) return false;
  if ((trigger.filterQuery ?? "").trim() !== "") return false;
  return !hasActionableTriggerFilters(trigger.filters);
}

/**
 * The filter fields that can only be answered once an EVALUATION has run.
 *
 * They are a set rather than a naming convention because the split decides
 * WHEN an automation is allowed to fire: a trigger carrying one of these is
 * matched by the evaluation pipeline after its result lands, and the trace
 * pipeline must skip it. A field missing from this set would be matched at
 * trace time against a result that does not exist yet, which fails closed —
 * the automation never fires — and a field wrongly IN it would move a
 * trace-time condition to a pipeline that may never run for that trace.
 */
const EVALUATION_TRIGGER_FILTER_FIELDS: ReadonlySet<string> = new Set([
  "evaluations.evaluator_id",
  "evaluations.evaluator_id.guardrails_only",
  "evaluations.evaluator_id.has_passed",
  "evaluations.evaluator_id.has_score",
  "evaluations.evaluator_id.has_label",
  "evaluations.passed",
  "evaluations.score",
  "evaluations.state",
  "evaluations.label",
]);

/**
 * Whether any of a trigger's filters can only be decided after an evaluation.
 *
 * The trace-alert subscriber uses this to leave such a trigger to the
 * evaluation pipeline instead of matching it on the trace alone.
 */
export function triggerFiltersNeedEvaluation(filters: Record<string, unknown>): boolean {
  return Object.keys(filters).some((field) => EVALUATION_TRIGGER_FILTER_FIELDS.has(field));
}
