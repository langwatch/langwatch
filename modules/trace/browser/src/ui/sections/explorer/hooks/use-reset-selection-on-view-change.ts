import { useExplorerStore } from "@langwatch/trace-browser-kit";
import { useEffect } from "react";

/**
 * The identity of what the table is showing: change any part of it and a row
 * means something else. Pagination, sort, density and column visibility are
 * deliberately absent — they change how the rows are shown, not which.
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
 * Clears the bulk selection and the open rows whenever the meaning of a row
 * could shift: query, window or lens. The view lives in the store, which
 * outlives the page, so a remount under another search keeps nothing checked.
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

  // While a relative-time label is active, from/to tick every minute (rolling
  // window). Only a real semantic change clears, so the time identity collapses
  // to the label when one is set.
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
