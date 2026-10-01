import { useExplorerStore } from "@langwatch/trace-browser-kit";
import { useEffect } from "react";

// The store's query only changes on discrete actions: Enter in the search bar, a
// facet click, a chip removed, a range slider released. None of them is a keystroke
// storm (typing never reaches the store), so both timers only coalesce a burst of
// clicks into one request.
const QUERY_DEBOUNCE_MS = 300;
const TIME_RANGE_DEBOUNCE_MS = 300;

/**
 * Mirrors the visual filter state (queryText, timeRange) into the debounced state that
 * drives network requests, so typing doesn't refetch on every key.
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
