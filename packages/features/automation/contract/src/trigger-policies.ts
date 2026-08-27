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
