import { useEffect } from "react";
import { useFilterStore } from "../../stores/filterStore";

// Query-text edits wait longer than time-range changes before hitting the
// backend. Every keystroke re-serialises `queryText`, and at 300ms a normal
// between-word pause fired a `list` query on a half-typed string (e.g.
// `status:error AND mode`) — each one a real ClickHouse round-trip whose
// result re-rendered the 50-row table, which read as typing lag. 600ms rides
// over fluent typing so the network only sees a settled query. Time-range
// changes come from discrete control clicks (no keystroke storm), so they
// keep the snappier 300ms.
const QUERY_DEBOUNCE_MS = 600;
const TIME_RANGE_DEBOUNCE_MS = 300;

/**
 * Mirrors the visual filter state (queryText, timeRange) into the debounced
 * state that drives network requests, so typing doesn't refetch on every key.
 * Query text and time range are debounced independently so a slow-typed query
 * never gets a short timer just because the time range also changed.
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
