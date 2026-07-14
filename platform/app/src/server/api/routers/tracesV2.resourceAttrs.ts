import { NON_BILLABLE_ATTR } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/span-cost.service";

/**
 * Internal cost-classification markers the receiver stamps on a span's
 * resource so the fold can roll the bundled portion into NonBilledCost. They
 * are plumbing, not user-facing metadata (the billed/bundled split is shown
 * as real amounts), so they are filtered out of the drawer's resource view.
 */
export const HIDDEN_RESOURCE_ATTRS: ReadonlySet<string> = new Set([
  NON_BILLABLE_ATTR,
]);

export function withoutHiddenResourceAttrs(
  attrs: Record<string, string>,
): Record<string, string> {
  let hasHidden = false;
  for (const key of HIDDEN_RESOURCE_ATTRS) {
    if (key in attrs) {
      hasHidden = true;
      break;
    }
  }
  if (!hasHidden) return attrs;
  return Object.fromEntries(
    Object.entries(attrs).filter(([key]) => !HIDDEN_RESOURCE_ATTRS.has(key)),
  );
}
