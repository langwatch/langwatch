import { useEffect, useRef } from "react";
import { useExplorerStore } from "../stores/explorerStore";

/**
 * Clears the bulk-selection set and the open rows whenever the meaning of a
 * row could shift underneath the user: filter expression, time range, or
 * active lens.
 *
 * Selection deliberately persists across pagination, sort, density, and
 * column visibility because those don't change *which* traces are shown,
 * only how they're presented.
 */
export function useResetSelectionOnViewChange(): void {
  const queryText = useExplorerStore((s) => s.debouncedQueryText);
  const timeFrom = useExplorerStore((s) => s.debouncedTimeRange.from);
  const timeTo = useExplorerStore((s) => s.debouncedTimeRange.to);
  const timeLabel = useExplorerStore((s) => s.debouncedTimeRange.label);
  const activeLensId = useExplorerStore((s) => s.activeLensId);

  const clear = useExplorerStore((s) => s.clearSelection);
  const setExpandedRows = useExplorerStore((s) => s.setExpandedRows);
  const firstRunRef = useRef(true);

  // While a relative-time label is active, from/to tick every minute
  // (rolling window). We only want to clear selection on real semantic
  // changes — collapse the time identity to the label when one is set.
  const timeKey = timeLabel ?? `${timeFrom}|${timeTo}`;

  useEffect(() => {
    if (firstRunRef.current) {
      firstRunRef.current = false;
      return;
    }
    clear();
    setExpandedRows([]);
  }, [queryText, timeKey, activeLensId, clear, setExpandedRows]);
}
