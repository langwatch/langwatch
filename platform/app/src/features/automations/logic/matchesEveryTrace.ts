import { filterChipsOf } from "~/components/automations/filterChips";

/**
 * A trace automation with no query, no structured filter and no evaluation
 * check has nothing narrowing it: it acts on every incoming trace. Graph
 * watchers and reports are never "every trace", so callers only ask for
 * trace automations.
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
  if (typeof filters === "string" || isRecord(filters)) {
    return filterChipsOf(filters).length === 0;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
