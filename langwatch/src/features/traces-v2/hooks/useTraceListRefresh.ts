import { useCallback } from "react";
import { api } from "~/utils/api";

/**
 * Invalidate the trace-list-side queries (list, discover, newCount).
 * Used by manual refresh affordances and by visibility/freshness signals
 * that want to surface anything that landed while we weren't looking.
 */
export function useTraceListRefresh(): () => void {
  const trpcUtils = api.useUtils();
  return useCallback(() => {
    void trpcUtils.tracesV2.list.invalidate();
    void trpcUtils.tracesV2.discover.invalidate();
    void trpcUtils.tracesV2.newCount.invalidate();
  }, [trpcUtils]);
}
