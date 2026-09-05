import { useEffect } from "react";
import { useFilterStore } from "../../../../index";

// Query-text edits wait longer than time-range changes before hitting the backend.
const QUERY_DEBOUNCE_MS = 600;
const TIME_RANGE_DEBOUNCE_MS = 300;

/**
 * Mirrors the visual filter state (queryText, timeRange) into the debounced state that
 * drives network requests, so typing doesn't refetch on every key.
 */
export const useDebouncedFilterCommit = (): void => {
  const queryText = useFilterStore((s) => s.queryText);
  const timeRange = useFilterStore((s) => s.timeRange);
  const commitDebounced = useFilterStore((s) => s.commitDebounced);

  useEffect(() => {
    const timer = setTimeout(commitDebounced, QUERY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [queryText, commitDebounced]);

  useEffect(() => {
    const timer = setTimeout(commitDebounced, TIME_RANGE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [timeRange, commitDebounced]);
};
