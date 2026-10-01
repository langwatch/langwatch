import { useSSESubscription } from "@langwatch/browser-host/sse-subscription";
import { useCallback, useEffect, useRef } from "react";

import { getTraceDrawer } from "../../../../behavior/trace-drawer.ts";
import { useRowPulseStore } from "../../../../behavior/row-pulse.store.ts";
import { useSseStatusStore } from "../../../../behavior/sse-status.store.ts";
import { api } from "../../../../behavior/trace-api.ts";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";
import { useTraceUpdateListener } from "../../use-trace-update-listener.ts";
import { useVisibleTraceIds } from "./use-visible-trace-ids.ts";

// Facets (`traces.discover`) are ~10x more expensive than the table list
// (~1.2s vs ~0.1s in our perf capture) and they only change when a *new*
// attribute value appears — far less frequently than a trace update. Coalesce
// invalidations into a longer window so a steady stream of new traces
// doesn't keep the sidebar permanently refetching.
const DISCOVER_INVALIDATE_DEBOUNCE_MS = 30_000;

// A busy coding-agent trace fires `trace_summary_updated` on nearly every span (its
// summary/metrics change each time), which otherwise refetches `newCount` every couple
// of seconds for a pill that didn't actually change count.
const NEWCOUNT_INVALIDATE_DEBOUNCE_MS = 10_000;

/**
 * Runs the action once per window: the first call starts the timer and later
 * calls within it ride along. The timer is dropped on unmount.
 */
function useCoalesced({ delayMs, action }: { delayMs: number; action: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionRef = useRef(action);
  actionRef.current = action;
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      actionRef.current();
    }, delayMs);
  }, [delayMs]);
}

/**
 * Sorts updated traces: a row already on screen pulses in place (in every
 * mode; `ask` gates new rows, not updates), an unseen one on page 1 means the
 * list needs a refresh, and one past page 1 is dropped until the reader pages.
 */
function partitionUpdates({
  traceIds,
  visibleIds,
  page,
}: {
  traceIds: string[];
  visibleIds: ReadonlySet<string>;
  page: number;
}): { visible: string[]; hasNewTrace: boolean } {
  const visible = traceIds.filter((id) => visibleIds.has(id));
  return { visible, hasNewTrace: page === 1 && visible.length < traceIds.length };
}

/**
 * A stored span refreshes every read of the open trace that changes shape with
 * it, keeping the cache push-fresh so polling can stay off while SSE is up.
 */
function useSpanStoredInvalidation(projectId: string | undefined) {
  const trpcUtils = api.useUtils();
  return useCallback(
    (traceIds: string[]) => {
      const { traceId: openTraceId } = getTraceDrawer();
      if (!openTraceId || !projectId || !traceIds.includes(openTraceId)) return;
      const key = { projectId, traceId: openTraceId };
      void trpcUtils.traces.spanTreeDelta.invalidate(key);
      void trpcUtils.traces.spanDetail.invalidate(key);
      void trpcUtils.traces.spanLangwatchSignals.invalidate(key);
      void trpcUtils.traces.traceEvents.invalidate(key);
      void trpcUtils.traces.resourceInfo.invalidate(key);
    },
    [trpcUtils, projectId],
  );
}

/** Mirrors the connection into the toolbar's store; disabled live updates read as disconnected. */
function useSseStatusSync({
  connectionState,
  lastEventAt,
  liveUpdatesEnabled,
}: {
  connectionState: ReturnType<typeof useTraceUpdateListener>["connectionState"];
  lastEventAt: number;
  liveUpdatesEnabled: boolean;
}) {
  const setSseConnectionState = useSseStatusStore((s) => s.setSseConnectionState);
  const setLastEventAt = useSseStatusStore((s) => s.setLastEventAt);
  useEffect(() => {
    setSseConnectionState(liveUpdatesEnabled ? connectionState : "disconnected");
  }, [connectionState, liveUpdatesEnabled, setSseConnectionState]);
  useEffect(() => {
    if (lastEventAt > 0) setLastEventAt(lastEventAt);
  }, [lastEventAt, setLastEventAt]);
}

/**
 * Coordinator hook that bridges SSE trace events into TanStack Query cache
 * invalidation. Mounted once in TracesPage.
 */
export function useTraceFreshness() {
  const { project } = useOrganizationTeamProject();
  const trpcUtils = api.useUtils();
  const pulse = useRowPulseStore((s) => s.pulse);
  const visibleTraceIds = useVisibleTraceIds();

  // A busy trace fires on nearly every span; the pill's count seldom changes.
  const refreshNewCount = useCoalesced({
    delayMs: NEWCOUNT_INVALIDATE_DEBOUNCE_MS,
    action: () => {
      void trpcUtils.traces.newCount.cancel();
      void trpcUtils.traces.newCount.invalidate();
    },
  });
  const refreshDiscover = useCoalesced({
    delayMs: DISCOVER_INVALIDATE_DEBOUNCE_MS,
    action: () => {
      void trpcUtils.traces.discover.cancel();
      void trpcUtils.traces.discover.invalidate();
    },
  });

  const onTraceSummaryUpdated = useCallback(
    (traceIds: string[]) => {
      const isLive = useSseStatusStore.getState().liveUpdatesMode === "live";
      refreshNewCount();
      const { visible, hasNewTrace } = partitionUpdates({
        traceIds,
        visibleIds: visibleTraceIds.ids,
        page: visibleTraceIds.page,
      });
      for (const traceId of visible) pulse(traceId);
      // Only live mode merges new traces, and the in-flight list read is cancelled
      // first so a slow earlier one cannot overwrite the fresh view.
      if (isLive && hasNewTrace) {
        void trpcUtils.traces.list.cancel();
        void trpcUtils.traces.list.invalidate();
      }
      // Facets are heavy: coalesced to 30s, and skipped outside live mode.
      if (isLive) refreshDiscover();
      // The open trace's reads, scoped to the project the queries are keyed under.
      const { traceId: openTraceId } = getTraceDrawer();
      const projectId = project?.id;
      if (!openTraceId || !projectId || !traceIds.includes(openTraceId)) return;
      const key = { projectId, traceId: openTraceId };
      void trpcUtils.traces.header.invalidate(key);
      void trpcUtils.traces.spanTree.invalidate(key);
      void trpcUtils.traces.evals.invalidate(key);
    },
    [
      trpcUtils,
      project?.id,
      visibleTraceIds,
      pulse,
      refreshNewCount,
      refreshDiscover,
    ],
  );

  const onSpanStored = useSpanStoredInvalidation(project?.id);

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
  // background refresh in TraceListService lands a fresher facets payload in the shared
  // cache; on receipt we invalidate, which refetches against the now-warm cache.
  useSSESubscription<{ tenantId: string; timestamp: number }, { projectId: string }>(
    // @ts-expect-error - tRPC subscription type isn't perfectly inferred for the
    // hook's generic; the underlying procedure shape matches.
    api.traces.onDiscoverUpdate,
    { projectId: project?.id ?? "" },
    {
      enabled: !!project?.id,
      onData: () => {
        void trpcUtils.traces.discover.invalidate();
      },
    },
  );

  useSseStatusSync({ connectionState, lastEventAt, liveUpdatesEnabled });
}
