import { useEffect } from "react";
import { useFilterStore } from "../../stores/filterStore";

const DEBOUNCE_MS = 300;

/**
 * Mirrors the visual filter state (queryText, timeRange) into the debounced
 * state that drives network requests, so typing doesn't refetch on every key.
 */
export const useDebouncedFilterCommit = (): void => {
  const queryText = useFilterStore((s) => s.queryText);
  const timeRange = useFilterStore((s) => s.timeRange);
  const commitDebounced = useFilterStore((s) => s.commitDebounced);

  useEffect(() => {
    const timer = setTimeout(commitDebounced, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [queryText, timeRange, commitDebounced]);
};
