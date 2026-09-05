import { useIsFetching } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { api } from "../../../../behavior/trace-api";
import { useRefreshUIStore } from "../../../../index";

/**
 * Smallest gap (ms) between two manual refresh clicks.
 */
const REFRESH_DEBOUNCE_MS = 350;

interface UseTraceListRefreshResult {
  /**
   * Trigger an invalidation of list / discover / newCount. Cancels any in-flight
   * fetches of the same keys first so the operator only ever sees the result of their
   * *most recent* click — not whichever round-trip happens to finish last.
   */
  refresh: () => void;
  /**
   * True while any of (list, discover, newCount) is fetching. Tied to the React-Query
   * cache directly so the spinner / tint stay on until the data actually lands, instead
   * of clearing after a fixed timeout.
   */
  isRefreshing: boolean;
  /**
   * The refresh BUTTON's spin state: an explicit refresh in flight, or a genuinely new
   * trace being merged into `list` — never a background `discover`/`newCount` refetch
   * triggered by a routine span update to a trace already on screen.
   */
  shouldSpin: boolean;
}

/**
 * Invalidate the trace-list-side queries (list, discover, newCount). Used by manual
 * refresh affordances and by visibility/freshness signals that want to surface anything
 * that landed while we weren't looking.
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
          (head.includes('"list"') || head.includes('"discover"') || head.includes('"newCount"'))
        );
      } catch {
        return false;
      }
    },
  });

  // Narrower than `fetchingCount` above: only a `list` fetch counts — not
  // `discover`/`newCount`, which refetch on routine background SSE activity
  // (a span landing on a trace already on screen), not just when a new trace
  // actually shows up.
  const listFetchingCount = useIsFetching({
    predicate: (q) => {
      const key = q.queryKey;
      if (!Array.isArray(key) || key.length === 0) return false;
      try {
        const head = JSON.stringify(key[0]);
        return head.includes('"tracesV2"') && head.includes('"list"');
      } catch {
        return false;
      }
    },
  });

  const requestRefresh = useRefreshUIStore((s) => s.requestRefresh);
  const refreshRequested = useRefreshUIStore((s) => s.refreshRequested);
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

  return {
    refresh,
    isRefreshing: fetchingCount > 0,
    shouldSpin: refreshRequested || listFetchingCount > 0,
  };
}
