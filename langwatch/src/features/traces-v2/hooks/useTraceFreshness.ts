import { useCallback, useEffect, useRef } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useTraceUpdateListener } from "~/hooks/useTraceUpdateListener";
import { api } from "~/utils/api";
import { useDrawerStore } from "../stores/drawerStore";
import { useRefreshUIStore } from "../stores/refreshUIStore";
import { useSseStatusStore } from "../stores/sseStatusStore";

// Facets (`tracesV2.discover`) are ~10x more expensive than the table list
// (~1.2s vs ~0.1s in our perf capture) and they only change when a *new*
// attribute value appears — far less frequently than a trace update. Coalesce
// invalidations into a longer window so a steady stream of new traces
// doesn't keep the sidebar permanently refetching.
const DISCOVER_INVALIDATE_DEBOUNCE_MS = 30_000;

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
  const requestFastPoll = useSseStatusStore((s) => s.requestFastPoll);
  const setSseConnectionState = useSseStatusStore(
    (s) => s.setSseConnectionState,
  );
  const setLastEventAt = useSseStatusStore((s) => s.setLastEventAt);
  const pulse = useRefreshUIStore((s) => s.pulse);
  const discoverInvalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    return () => {
      if (discoverInvalidateTimer.current) {
        clearTimeout(discoverInvalidateTimer.current);
      }
    };
  }, []);

  const onTraceSummaryUpdated = useCallback(
    (traceIds: string[]) => {
      // Spin the refresh icon for every update event — invalidations that
      // resolve from cache wouldn't otherwise flip isFetching long enough
      // for the user to notice anything happened.
      pulse();

      // Table-level invalidation — TQ only refetches mounted queries
      void trpcUtils.tracesV2.list.invalidate();
      void trpcUtils.tracesV2.newCount.invalidate();
      // Discover (facets) is heavy. Coalesce into a 30s window so a steady
      // trace stream doesn't keep it permanently refetching.
      if (!discoverInvalidateTimer.current) {
        discoverInvalidateTimer.current = setTimeout(() => {
          discoverInvalidateTimer.current = null;
          void trpcUtils.tracesV2.discover.invalidate();
        }, DISCOVER_INVALIDATE_DEBOUNCE_MS);
      }

      // Reset adaptive polling to fast interval
      requestFastPoll();

      // Targeted drawer invalidation. Project-scoped explicitly so the
      // partial-input filter matches the project queries are keyed under,
      // not just every header/spanTree/evals query in the cache.
      const { traceId: openTraceId } = useDrawerStore.getState();
      const projectId = project?.id;
      if (openTraceId && projectId && traceIds.includes(openTraceId)) {
        void trpcUtils.tracesV2.header.invalidate({
          projectId,
          traceId: openTraceId,
        });
        void trpcUtils.tracesV2.spanTree.invalidate({
          projectId,
          traceId: openTraceId,
        });
        void trpcUtils.tracesV2.evals.invalidate({
          projectId,
          traceId: openTraceId,
        });
      }
    },
    [trpcUtils, requestFastPoll, pulse, project?.id],
  );

  const onSpanStored = useCallback(
    (traceIds: string[]) => {
      const { traceId: openTraceId } = useDrawerStore.getState();
      const projectId = project?.id;
      if (!openTraceId || !projectId || !traceIds.includes(openTraceId)) return;

      void trpcUtils.tracesV2.spanTree.invalidate({
        projectId,
        traceId: openTraceId,
      });
      void trpcUtils.tracesV2.spanDetail.invalidate({
        projectId,
        traceId: openTraceId,
      });
    },
    [trpcUtils, project?.id],
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
}
