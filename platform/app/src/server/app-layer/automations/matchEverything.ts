import { TriggerKind } from "~/generated/prisma/client";

import { hasActionableTriggerFilters } from "~/server/filters/triggerFilter.matcher";
import type { TriggerSummary } from "./repositories/trigger.repository";

/**
 * A trace automation with nothing to narrow it: no structured filter that
 * selects anything, and no query. Every trace the project ingests matches it.
 *
 * The server now refuses to SAVE this shape, but rows created before that rule
 * existed keep running, so nothing a customer relies on breaks on deploy. This
 * predicate is how the rest of the system recognises those grandfathered rows:
 * the trigger cache logs them once per fill so we can see how many are left,
 * and runaway containment treats the shape as a pause qualifier, because an
 * automation that matches everything AND blows through its daily ceiling is
 * misconfigured rather than merely busy.
 *
 * Alerts and reports are excluded: an alert's condition is its threshold and a
 * report's is its schedule, and both legitimately persist an empty `filters`.
 */
export function isMatchEverythingTrigger(trigger: TriggerSummary): boolean {
  if (trigger.triggerKind !== TriggerKind.AUTOMATION) return false;
  if (trigger.customGraphId) return false;
  if ((trigger.filterQuery ?? "").trim() !== "") return false;
  return !hasActionableTriggerFilters(trigger.filters);
}
