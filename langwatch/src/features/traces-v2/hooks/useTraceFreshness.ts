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

  const recordPendingTraceIds = useSseStatusStore(
    (s) => s.recordPendingTraceIds,
  );

  const onTraceSummaryUpdated = useCallback(
    (traceIds: string[]) => {
      const mode = useSseStatusStore.getState().liveUpdatesMode;

      // Spin the refresh icon for every update event — invalidations that
      // resolve from cache wouldn't otherwise flip isFetching long enough
      // for the user to notice anything happened. Skipped in `ask` mode
      // because the operator hasn't asked to see anything yet — flashing
      // the icon would look like a stealth refresh.
      if (mode === "live") pulse();

      if (mode === "ask") {
        // Buffer instead of refetching: surface "(N new)" in the toolbar
        // and let the user opt in by clicking. The list query stays on
        // its current snapshot until they do, so reading a row doesn't
        // get yanked by an auto-refresh.
        recordPendingTraceIds(traceIds);
      } else {
        // Table-level invalidation — TQ only refetches mounted queries
        void trpcUtils.tracesV2.list.invalidate();
        void trpcUtils.tracesV2.newCount.invalidate();
      }
      // Discover (facets) is heavy. Coalesce into a 30s window so a steady
      // trace stream doesn't keep it permanently refetching. Skipped in
      // `ask` mode for the same reason — wait for the user to ask.
      if (mode === "live" && !discoverInvalidateTimer.current) {
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
      // The drawer is what the user explicitly opened, so even in `ask`
      // mode we still keep its contents fresh — `ask` only suppresses
      // the implicit list refetch.
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
    [trpcUtils, requestFastPoll, pulse, project?.id, recordPendingTraceIds],
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

  // Honour the operator's "live updates" preference — when disabled,
  // skip subscribing and force the connection state to disconnected so
  // the toolbar indicator reads correctly.
  const liveUpdatesEnabled = useSseStatusStore(
    (s) => s.liveUpdatesEnabled,
  );

  const { connectionState, lastEventAt } = useTraceUpdateListener({
    projectId: project?.id ?? "",
    enabled: !!project?.id && liveUpdatesEnabled,
    onTraceSummaryUpdated,
    onSpanStored,
    debounceMs: 2000,
    maxWaitMs: 2000,
  });

  useEffect(() => {
    setSseConnectionState(
      liveUpdatesEnabled ? connectionState : "disconnected",
    );
  }, [connectionState, liveUpdatesEnabled, setSseConnectionState]);

  useEffect(() => {
    if (lastEventAt > 0) {
      setLastEventAt(lastEventAt);
    }
  }, [lastEventAt, setLastEventAt]);
}
