import type { LangyContextChip } from "../../../../behavior/langy/langy.store.ts";

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
    query.length > MAX_FILTER_SUMMARY ? `${query.slice(0, MAX_FILTER_SUMMARY - 1)}…` : query;

  return {
    id: `filter:${query}`,
    kind: "filter",
    label: `filtered: ${summary}`,
    // Forward the full query so the agent can apply the same scope.
    ref: query,
  };
}
