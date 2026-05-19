import { useCallback } from "react";
import { api } from "~/utils/api";
import { useRefreshUIStore } from "../stores/refreshUIStore";
import { useSseStatusStore } from "../stores/sseStatusStore";

/**
 * Flush callback for the toolbar's "(N new)" badge. Invalidates the
 * trace list + count queries, spins the refresh icon, and drops the
 * buffered IDs so the badge disappears. Same surface area as
 * `useTraceListRefresh`, just gated on there actually being buffered
 * updates so a click while empty doesn't kick off a no-op refetch.
 */
export function useFlushPendingTraces() {
  const trpcUtils = api.useContext();
  const pulse = useRefreshUIStore((s) => s.pulse);

  return useCallback(() => {
    const { pendingTraceIds, clearPendingTraceIds } =
      useSseStatusStore.getState();
    if (pendingTraceIds.size === 0) return;
    clearPendingTraceIds();
    pulse();
    void trpcUtils.tracesV2.list.invalidate();
    void trpcUtils.tracesV2.newCount.invalidate();
    void trpcUtils.tracesV2.discover.invalidate();
  }, [pulse, trpcUtils]);
}
