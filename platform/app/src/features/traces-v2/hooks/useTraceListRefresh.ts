import { useIsFetching } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { api } from "~/utils/api";
import { useRefreshUIStore } from "../stores/refreshUIStore";

/**
 * Smallest gap (ms) between two manual refresh clicks. Multiple clicks
 * inside this window collapse to a single invalidation — without it a
 * frustrated operator hammering the icon would queue up N round-trips
 * the backend has to honour before it gets to serve the latest data.
 */
const REFRESH_DEBOUNCE_MS = 350;

interface UseTraceListRefreshResult {
  /**
   * Trigger an invalidation of list / discover / newCount. Cancels any
   * in-flight fetches of the same keys first so the operator only ever
   * sees the result of their *most recent* click — not whichever
   * round-trip happens to finish last.
   */
  refresh: () => void;
  /**
   * True while any of (list, discover, newCount) is fetching. Tied to
   * the React-Query cache directly so the spinner / tint stay on until
   * the data actually lands, instead of clearing after a fixed
   * timeout.
   */
  isRefreshing: boolean;
}

/**
 * Invalidate the trace-list-side queries (list, discover, newCount).
 * Used by manual refresh affordances and by visibility/freshness signals
 * that want to surface anything that landed while we weren't looking.
 *
 * Returns both the action AND an `isRefreshing` flag sourced from
 * tanstack's `useIsFetching` so callers can mirror the loading state
 * onto a spinner/tint that stays visible for the full duration of the
 * fetch (the previous fixed 900ms pulse cleared the spinner mid-fetch
 * on slow projects, which looked like the refresh had failed).
 */
export function useTraceListRefresh(): UseTraceListRefreshResult {
  const trpcUtils = api.useUtils();
  const lastClickRef = useRef(0);

  // Count any in-flight trace-explorer queries. tRPC's query keys are
  // arrays like `[["tracesV2", "list"], ...]`; checking the JSON form
  // catches every (list, discover, newCount) variant without needing
  // to enumerate them one by one.
  const fetchingCount = useIsFetching({
    predicate: (q) => {
      const key = q.queryKey;
      if (!Array.isArray(key) || key.length === 0) return false;
      try {
        const head = JSON.stringify(key[0]);
        return (
          head.includes('"tracesV2"') &&
          (head.includes('"list"') ||
            head.includes('"discover"') ||
            head.includes('"newCount"'))
        );
      } catch {
        return false;
      }
    },
  });

  const requestRefresh = useRefreshUIStore((s) => s.requestRefresh);
  const refresh = useCallback(() => {
    const now = Date.now();
    if (now - lastClickRef.current < REFRESH_DEBOUNCE_MS) return;
    lastClickRef.current = now;
    // Mark this as an *explicit* refresh so the aurora ribbon plays.
    // Background refetches (SSE invalidations on span arrival / trace
    // update) never pass through here and stay aurora-free.
    requestRefresh();
    // Cancel before invalidate so a slow previous round-trip can't
    // race the fresh one and overwrite the view with stale data.
    void trpcUtils.tracesV2.list.cancel();
    void trpcUtils.tracesV2.discover.cancel();
    void trpcUtils.tracesV2.newCount.cancel();
    void trpcUtils.tracesV2.list.invalidate();
    void trpcUtils.tracesV2.discover.invalidate();
    void trpcUtils.tracesV2.newCount.invalidate();
  }, [trpcUtils, requestRefresh]);

  return { refresh, isRefreshing: fetchingCount > 0 };
}
