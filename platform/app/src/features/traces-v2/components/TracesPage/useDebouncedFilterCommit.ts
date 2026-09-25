import { useEffect } from "react";
import { useExplorerStore } from "../../stores/explorerStore";

// The store's query only changes on discrete actions: Enter in the search
// bar, a facet click, a chip removed, a range slider released. None of them
// is a keystroke storm (typing never reaches the store), so both timers only
// coalesce a burst of clicks into one request, which is what the spec's
// 300ms checkbox debounce asks for.
const QUERY_DEBOUNCE_MS = 300;
const TIME_RANGE_DEBOUNCE_MS = 300;

/**
 * Mirrors the visual filter state (queryText, timeRange) into the debounced
 * state that drives network requests, so a burst of facet clicks refetches
 * once. Query-text and time-range changes each schedule a commit on their own
 * timer; whichever fires reads and commits the CURRENT query + time range
 * together via `commitDebounced`.
 */
export const useDebouncedFilterCommit = (): void => {
  const queryText = useExplorerStore((s) => s.queryText);
  const timeRange = useExplorerStore((s) => s.timeRange);
  const commitDebounced = useExplorerStore((s) => s.commitDebounced);

  useEffect(() => {
    const timer = setTimeout(commitDebounced, QUERY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [queryText, commitDebounced]);

  useEffect(() => {
    const timer = setTimeout(commitDebounced, TIME_RANGE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [timeRange, commitDebounced]);
};
