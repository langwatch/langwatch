import { useCallback, useEffect, useRef } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useTraceUpdateListener } from "~/hooks/useTraceUpdateListener";
import { api } from "~/utils/api";
import { useDrawerStore } from "../stores/drawerStore";
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
      const mode = useSseStatusStore.getState().liveUpdatesMode;

      // The refresh pulse (top-of-page aurora) used to fire on every
      // SSE trace_summary_updated event in "live" mode. For high-
      // throughput projects that's a constant flash — users called it
      // out as visual noise that didn't seem to correspond to anything
      // appearing in the table. We now keep the pulse for two cases
      // only:
      //
      //   1. User-initiated refresh — handled implicitly via
      //      `useTraceListRefresh.refresh()` and lens/tab/refresh
      //      switches that flip TanStack's `isFetching`.
      //   2. An incoming trace that's about to land in the visible
      //      window — handled in `useTraceNewCount` (it watches the
      //      newCount response and pulses when count rises above zero
      //      in live mode, just before the list refetch lands the new
      //      rows under the user's cursor).
      //
      // The bare SSE event no longer fires the pulse. The (N new) pill
      // remains the per-event surface — it stays accurate because we
      // still invalidate `newCount` below.

      // Refresh the new-count query in BOTH live and ask modes so the
      // floating "(N new)" pill stays in sync. In `ask` we deliberately
      // skip the list refetch so the table doesn't jump under the
      // cursor — the operator clicks the pill to commit the merge,
      // which calls `acknowledge()` and pulls the new rows.
      void trpcUtils.tracesV2.newCount.invalidate();
      if (mode === "live") {
        void trpcUtils.tracesV2.list.invalidate();
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
    [trpcUtils, requestFastPoll, project?.id],
  );

  const onSpanStored = useCallback(
    (traceIds: string[]) => {
      const { traceId: openTraceId } = useDrawerStore.getState();
      const projectId = project?.id;
      if (!openTraceId || !projectId || !traceIds.includes(openTraceId)) return;

      // Invalidate every per-trace query that changes shape when a new
      // span lands — keeps the cache push-fresh so the per-hook
      // refetchInterval can stay off while SSE is connected. Each
      // query is also scoped by `projectId` + `traceId` so we only
      // invalidate the open trace, not the entire CSR cache.
      void trpcUtils.tracesV2.spanTree.invalidate({
        projectId,
        traceId: openTraceId,
      });
      void trpcUtils.tracesV2.spanDetail.invalidate({
        projectId,
        traceId: openTraceId,
      });
      void trpcUtils.tracesV2.spanLangwatchSignals.invalidate({
        projectId,
        traceId: openTraceId,
      });
      void trpcUtils.tracesV2.traceEvents.invalidate({
        projectId,
        traceId: openTraceId,
      });
      void trpcUtils.tracesV2.resourceInfo.invalidate({
        projectId,
        traceId: openTraceId,
      });
    },
    [trpcUtils, project?.id],
  );

  // Honour the operator's "live updates" preference — when disabled,
  // skip subscribing and force the connection state to disconnected so
  // the toolbar indicator reads correctly.
  const liveUpdatesEnabled = useSseStatusStore((s) => s.liveUpdatesEnabled);

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
