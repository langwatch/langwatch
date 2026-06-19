import { useCallback, useEffect, useRef } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useSSESubscription } from "~/hooks/useSSESubscription";
import { useTraceUpdateListener } from "~/hooks/useTraceUpdateListener";
import { api } from "~/utils/api";
import { useDrawerStore } from "../stores/drawerStore";
import { useRowPulseStore } from "../stores/rowPulseStore";
import { useSseStatusStore } from "../stores/sseStatusStore";
import { useVisibleTraceIds } from "./useVisibleTraceIds";

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
 * On trace_summary_updated:
 *   - Visible rows: pulse in-place via rowPulseStore; no list invalidation.
 *   - New trace on page 1: cancel + invalidate list.
 *   - Off-screen / wrong page: cancel + invalidate newCount only.
 *   - In all cases: invalidate newCount so the pill stays accurate.
 *
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
  const pulse = useRowPulseStore((s) => s.pulse);
  const visibleTraceIds = useVisibleTraceIds();

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

      // newCount is always kept current so the "(N new)" pill stays in
      // sync across all modes (live, ask, paused). Cancel before
      // invalidate so in-flight stale responses don't race a fresh one.
      void trpcUtils.tracesV2.newCount.cancel();
      void trpcUtils.tracesV2.newCount.invalidate();

      // Partition incoming trace IDs into three buckets:
      //   1. visible  — already rendered in the current page → pulse only
      //   2. new      — not visible AND page === 1 → need a list refresh
      //   3. off-screen — not visible AND page > 1  → drop (pagination
      //                   will fetch fresh data when the user navigates)
      const { ids: visibleIds, page } = visibleTraceIds;

      let hasNewTrace = false;
      for (const traceId of traceIds) {
        if (visibleIds.has(traceId)) {
          // In-place update — animate the row, skip network round-trip.
          // The pulse fires in every mode (live / ask / paused): `ask`
          // gates *new trace prepends*, not updates to rows the user is
          // already looking at. Suppressing the pulse in ask mode would
          // mean a row visibly changes its underlying data without any
          // signal — worse UX than the pulse itself.
          pulse(traceId);
        } else if (page === 1) {
          // New trace that belongs on page 1 (highest priority view).
          hasNewTrace = true;
        }
        // Off-screen updates (page > 1) are silently dropped — the
        // user isn't looking at those rows, and paginating will fetch
        // the freshest data when they arrive.
      }

      if (mode === "live" && hasNewTrace) {
        // Only `live` mode auto-merges new traces. `ask` mode keeps the
        // pill count fresh (via newCount above) but waits for the user
        // to opt in by clicking it. Cancel any in-flight list fetch
        // before kicking a new one so a slow previous round-trip can't
        // race the fresh one and overwrite the view with stale data.
        void trpcUtils.tracesV2.list.cancel();
        void trpcUtils.tracesV2.list.invalidate();
      }

      if (mode === "live") {
        // Discover (facets) is heavy. Coalesce into a 30s window so a
        // steady trace stream doesn't keep it permanently refetching.
        // `ask` / `paused` modes skip discover entirely — the user
        // explicitly opted out of background churn.
        if (!discoverInvalidateTimer.current) {
          discoverInvalidateTimer.current = setTimeout(() => {
            discoverInvalidateTimer.current = null;
            void trpcUtils.tracesV2.discover.cancel();
            void trpcUtils.tracesV2.discover.invalidate();
          }, DISCOVER_INVALIDATE_DEBOUNCE_MS);
        }
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
    [trpcUtils, requestFastPoll, project?.id, visibleTraceIds, pulse],
  );

  const onSpanStored = useCallback(
    (traceIds: string[]) => {
      const { traceId: openTraceId } = useDrawerStore.getState();
      const projectId = project?.id;
      if (!openTraceId || !projectId || !traceIds.includes(openTraceId)) return;

      // Invalidate every per-trace query that changes shape when a new
      // span lands — keeps the cache push-fresh so the per-hook
      // refetchInterval can stay off while SSE is connected. The key
      // is scoped to `projectId` + `traceId` so only the open trace
      // is invalidated, not the entire CSR cache.
      const key = { projectId, traceId: openTraceId };
      void trpcUtils.tracesV2.spanTree.invalidate(key);
      void trpcUtils.tracesV2.spanDetail.invalidate(key);
      void trpcUtils.tracesV2.spanLangwatchSignals.invalidate(key);
      void trpcUtils.tracesV2.traceEvents.invalidate(key);
      void trpcUtils.tracesV2.resourceInfo.invalidate(key);
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

  // `discover` (facets) freshness. The server fires `discover_updated` when a
  // background refresh in TraceListService lands a fresher facets payload in
  // the shared cache; on receipt we invalidate, which refetches against the
  // now-warm cache. This lives in the page-level coordinator rather than inside
  // useTraceFacets because that hook is consumed by several sidebar components
  // (SearchBar, FilterSidebar, TokenValuePicker) and tRPC subscriptions are not
  // deduplicated across hook instances the way queries are: one subscription
  // per consumer opened a duplicate SSE connection each, and on HTTP/1.1 (dev)
  // those persistent connections starve the 6-per-origin pool, leaving query
  // bursts (the drawer opening) stuck pending. One coordinator subscription
  // invalidates the shared query, refreshing every consumer.
  useSSESubscription<
    { tenantId: string; timestamp: number },
    { projectId: string }
  >(
    // @ts-expect-error - tRPC subscription type isn't perfectly inferred for the
    // hook's generic; the underlying procedure shape matches.
    api.tracesV2.onDiscoverUpdate,
    { projectId: project?.id ?? "" },
    {
      enabled: !!project?.id,
      onData: () => {
        void trpcUtils.tracesV2.discover.invalidate();
      },
    },
  );

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
