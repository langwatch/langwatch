import { useCallback, useEffect } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useTraceUpdateListener } from "~/hooks/useTraceUpdateListener";
import { api } from "~/utils/api";
import { useDrawerStore } from "../stores/drawerStore";
import { useFreshnessSignal } from "../stores/freshnessSignal";

/**
 * Coordinator hook that bridges SSE trace events into TanStack Query
 * cache invalidation. Mounted once in TracesPage.
 *
 * On trace_summary_updated: invalidates list, facets, newCount.
 * If the drawer is open for an affected trace, also invalidates
 * header, spanSummary, and evals.
 *
 * On span_stored: if the drawer is open for an affected trace,
 * invalidates spanSummary and spanDetail.
 */
export function useTraceFreshness() {
  const { project } = useOrganizationTeamProject();
  const trpcUtils = api.useContext();
  const requestFastPoll = useFreshnessSignal((s) => s.requestFastPoll);
  const setSseConnectionState = useFreshnessSignal((s) => s.setSseConnectionState);
  const setLastEventAt = useFreshnessSignal((s) => s.setLastEventAt);
  const setRefresh = useFreshnessSignal((s) => s.setRefresh);

  const onTraceSummaryUpdated = useCallback(
    (traceIds: string[]) => {
      // Table-level invalidation — TQ only refetches mounted queries
      void trpcUtils.tracesV2.list.invalidate();
      void trpcUtils.tracesV2.discover.invalidate();
      void trpcUtils.tracesV2.newCount.invalidate();

      // Reset adaptive polling to fast interval
      requestFastPoll();

      // Targeted drawer invalidation
      const { traceId: openTraceId } = useDrawerStore.getState();
      if (openTraceId && traceIds.includes(openTraceId)) {
        void trpcUtils.tracesV2.header.invalidate({ traceId: openTraceId });
        void trpcUtils.tracesV2.spanTree.invalidate({
          traceId: openTraceId,
        });
        void trpcUtils.tracesV2.evals.invalidate({ traceId: openTraceId });
      }
    },
    [trpcUtils, requestFastPoll],
  );

  const onSpanStored = useCallback(
    (traceIds: string[]) => {
      const { traceId: openTraceId } = useDrawerStore.getState();
      if (!openTraceId || !traceIds.includes(openTraceId)) return;

      void trpcUtils.tracesV2.spanTree.invalidate({
        traceId: openTraceId,
      });
      void trpcUtils.tracesV2.spanDetail.invalidate({
        traceId: openTraceId,
      });
    },
    [trpcUtils],
  );

  const { connectionState, lastEventAt } = useTraceUpdateListener({
    projectId: project?.id ?? "",
    enabled: !!project?.id,
    onTraceSummaryUpdated,
    onSpanStored,
    debounceMs: 2000,
    maxWaitMs: 2000,
  });

  useEffect(() => {
    setSseConnectionState(connectionState);
  }, [connectionState, setSseConnectionState]);

  useEffect(() => {
    if (lastEventAt > 0) {
      setLastEventAt(lastEventAt);
    }
  }, [lastEventAt, setLastEventAt]);

  const refresh = useCallback(() => {
    void trpcUtils.tracesV2.list.invalidate();
    void trpcUtils.tracesV2.discover.invalidate();
    void trpcUtils.tracesV2.newCount.invalidate();
  }, [trpcUtils]);

  useEffect(() => {
    setRefresh(refresh);
  }, [refresh, setRefresh]);
}
