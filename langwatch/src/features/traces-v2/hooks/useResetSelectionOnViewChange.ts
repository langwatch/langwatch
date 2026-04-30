import { useEffect, useRef } from "react";
import { useFilterStore } from "../stores/filterStore";
import { useSelectionStore } from "../stores/selectionStore";
import { useViewStore } from "../stores/viewStore";

/**
 * Clears the bulk-selection set whenever the meaning of a row could shift
 * underneath the user — filter expression, time range, or active lens.
 *
 * Selection deliberately persists across pagination, sort, density, and
 * column visibility because those don't change *which* traces are shown,
 * only how they're presented.
 */
export function useResetSelectionOnViewChange(): void {
  const queryText = useFilterStore((s) => s.debouncedQueryText);
  const timeFrom = useFilterStore((s) => s.debouncedTimeRange.from);
  const timeTo = useFilterStore((s) => s.debouncedTimeRange.to);
  const timeLabel = useFilterStore((s) => s.debouncedTimeRange.label);
  const activeLensId = useViewStore((s) => s.activeLensId);

  const clear = useSelectionStore((s) => s.clear);
  const firstRunRef = useRef(true);

  useEffect(() => {
    if (firstRunRef.current) {
      firstRunRef.current = false;
      return;
    }
    clear();
  }, [queryText, timeFrom, timeTo, timeLabel, activeLensId, clear]);
}
