import { useMemo } from "react";
import { useFilterStore } from "../../traces-v2/stores/filterStore";
import type { LangyContextChip } from "../stores/langyStore";

/**
 * Turns the Trace Explorer's active filter query into a Langy context chip —
 * "filtered: <query>" — so the agent scopes "these traces" to what the user has
 * narrowed the table to. Reads the shared `filterStore` query text (the liqe
 * expression that drives the table).
 *
 * Returns `null` when the query is empty. Deliberately keyed on the query text
 * only, not the time range: the default 30-day window isn't "filtering", and
 * surfacing it would put a low-signal chip on the composer for every visit. The
 * caller route-gates this to the Trace Explorer (the store is a module
 * singleton whose query survives navigation).
 */
export function useLangyFilterContext(): LangyContextChip | null {
  const queryText = useFilterStore((s) => s.queryText);

  return useMemo(() => filterContextChip(queryText), [queryText]);
}

/** Max characters shown in the filter chip before an ellipsis. */
const MAX_FILTER_SUMMARY = 48;

/**
 * Build the filter chip from the query text. Pure so it can be unit-tested.
 * The id embeds the query so a dismissed chip re-surfaces when the user edits
 * the filter to something different; an empty query yields no chip.
 */
export function filterContextChip(queryText: string): LangyContextChip | null {
  const query = queryText.trim();
  if (!query) return null;

  const summary =
    query.length > MAX_FILTER_SUMMARY
      ? `${query.slice(0, MAX_FILTER_SUMMARY - 1)}…`
      : query;

  return {
    id: `filter:${query}`,
    kind: "filter",
    label: `filtered: ${summary}`,
    // Forward the full query so the agent can apply the same scope.
    ref: query,
  };
}
