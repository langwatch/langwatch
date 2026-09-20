import { useEffect } from "react";
import { useExplorerStore } from "../stores/explorerStore";

/**
 * The identity of what the table is showing: change any part of it and a row
 * means something else. Pagination, sort, density and column visibility are
 * deliberately absent, since they change how the rows are shown and not which
 * rows they are.
 */
export function explorerViewKey({
  activeLensId,
  queryText,
  timeKey,
}: {
  activeLensId: string;
  queryText: string;
  timeKey: string;
}): string {
  // Serialised rather than joined on a separator: a query can hold any
  // character, so only an escaping encoder keeps two different views apart.
  return JSON.stringify([activeLensId, queryText, timeKey]);
}

/**
 * Clears the bulk-selection set and the open rows whenever the meaning of a
 * row could shift underneath the user: filter expression, time range, or
 * active lens.
 *
 * The view the selection belongs to is kept in the store, not in this hook,
 * because the store outlives the page. Leaving the Explorer, changing the
 * search from somewhere else (a Langy card's link) and coming back mounts a
 * new hook over the same selection, and a hook that only watched its own
 * renders would keep rows checked that the new search never listed.
 */
export function useResetSelectionOnViewChange(): void {
  const queryText = useExplorerStore((s) => s.debouncedQueryText);
  const timeFrom = useExplorerStore((s) => s.debouncedTimeRange.from);
  const timeTo = useExplorerStore((s) => s.debouncedTimeRange.to);
  const timeLabel = useExplorerStore((s) => s.debouncedTimeRange.label);
  const activeLensId = useExplorerStore((s) => s.activeLensId);

  const clear = useExplorerStore((s) => s.clearSelection);
  const setExpandedRows = useExplorerStore((s) => s.setExpandedRows);
  const setSelectionViewKey = useExplorerStore((s) => s.setSelectionViewKey);

  // While a relative-time label is active, from/to tick every minute
  // (rolling window). We only want to clear selection on real semantic
  // changes — collapse the time identity to the label when one is set.
  const timeKey = timeLabel ?? `${timeFrom}|${timeTo}`;
  const viewKey = explorerViewKey({ activeLensId, queryText, timeKey });

  useEffect(() => {
    const previous = useExplorerStore.getState().selectionViewKey;
    setSelectionViewKey(viewKey);
    // Nothing has been selected under any view yet, or this is the same view
    // the selection was made under.
    if (previous === null || previous === viewKey) return;
    clear();
    setExpandedRows([]);
  }, [viewKey, clear, setExpandedRows, setSelectionViewKey]);
}
