import { parseAutomationFiltersWire } from "@langwatch/automation-contract";

import { filtersAreSet } from "./draft-reducer.ts";

/**
 * A trace automation with no query, no structured filter and no evaluation
 * check acts on every incoming trace. Graph watchers and reports are never
 * "every trace", so callers only ask for trace automations.
 */
export function matchesEveryTrace({
  filterQuery,
  filters,
  checkCount = 0,
}: {
  filterQuery: string | null | undefined;
  filters: unknown;
  checkCount?: number;
}): boolean {
  if ((filterQuery ?? "").trim().length > 0) return false;
  if (checkCount > 0) return false;
  const wire = typeof filters === "string" ? parseJson(filters) : filters;
  return !filtersAreSet(parseAutomationFiltersWire(wire));
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
