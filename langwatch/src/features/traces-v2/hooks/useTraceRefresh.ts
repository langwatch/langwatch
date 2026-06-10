import { useCallback, useState } from "react";
import { api } from "~/utils/api";

/**
 * Refresh-button handler for the drawer header. Invalidates everything
 * that backs the drawer + the underlying trace-table row, so projection
 * updates that landed since open propagate without a page reload.
 *
 * Returns `{ refresh, isRefreshing }`. `isRefreshing` is true for the
 * round-trip; the trigger button uses it to spin.
 */
export function useTraceRefresh(traceId: string) {
  const trpcUtils = api.useUtils();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await Promise.all([
        trpcUtils.tracesV2.header.invalidate({ traceId }),
        trpcUtils.tracesV2.spanTree.invalidate({ traceId }),
        trpcUtils.tracesV2.evals.invalidate({ traceId }),
        // Refreshing inside the drawer should also bring the row in the
        // underlying table back in sync — without this, fields like
        // duration / cost / status that the projection just refreshed
        // stay stale on the table while the drawer shows the latest.
        trpcUtils.tracesV2.list.invalidate(),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, traceId, trpcUtils]);

  return { refresh, isRefreshing };
}
