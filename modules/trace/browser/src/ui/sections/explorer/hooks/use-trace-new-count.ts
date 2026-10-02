import { usePageVisibility } from "@langwatch/browser-host/page-visibility";
import { nowInstant } from "@langwatch/time";
import { useCallback, useEffect, useRef, useState } from "react";

import { useFilterStore } from "../../../../behavior/explorer.store.ts";
import { useRefreshUIStore } from "../../../../behavior/refresh-ui.store.ts";
import { useSseStatusStore } from "../../../../behavior/sse-status.store.ts";
import { api } from "../../../../behavior/trace-api.ts";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";
import { useInstantEvalRuns } from "./use-instant-eval-runs.ts";
import { useTraceListRefresh } from "./use-trace-list-refresh.ts";

interface TraceNewCountResult {
  count: number;
  isLoading: boolean;
  /** Reset the count to 0 (advances `since` to now) and pulls the latest list. */
  acknowledge: () => void;
}

// What a tab returning to view refetches depends on the operator's live-updates mode.
function resumeLiveUpdates({
  refresh,
  invalidateCount,
}: {
  refresh: () => void;
  invalidateCount: () => Promise<void>;
}): void {
  const mode = useSseStatusStore.getState().liveUpdatesMode;
  if (mode === "live") {
    refresh();
    return;
  }
  if (mode === "ask") void invalidateCount();
}

function newCountQueryInput({
  projectId,
  timeRange,
  since,
  queryText,
  evalRuns,
}: {
  projectId: string | undefined;
  timeRange: { from: number; to: number; label?: string };
  since: number;
  queryText: string;
  evalRuns: ReturnType<typeof useInstantEvalRuns>["evalRuns"];
}) {
  return {
    projectId: projectId ?? "",
    timeRange: {
      from: timeRange.from,
      to: timeRange.to,
      live: !!timeRange.label,
    },
    since,
    query: queryText || undefined,
    ...(evalRuns ? { evalRuns } : {}),
  };
}

// The 0→N transition in live mode; the first success in a new query context
// (prev === null) is baseline only.
function isFirstLiveArrival({ prev, count }: { prev: number | null; count: number }): boolean {
  return prev === 0 && count > 0 && useSseStatusStore.getState().liveUpdatesMode === "live";
}

export function useTraceNewCount(): TraceNewCountResult {
  const { project } = useOrganizationTeamProject();
  const timeRange = useFilterStore((s) => s.debouncedTimeRange);
  const queryText = useFilterStore((s) => s.debouncedQueryText);
  const [since, setSince] = useState(() => nowInstant().epochMilliseconds);
  const { refresh } = useTraceListRefresh();

  const isVisible = usePageVisibility();

  // When the tab becomes visible again, what we refetch depends on the operator's
  // live-updates mode:
  const trpcUtils = api.useUtils();
  const prevVisibleRef = useRef(isVisible);
  useEffect(() => {
    if (isVisible && !prevVisibleRef.current) {
      resumeLiveUpdates({
        refresh,
        invalidateCount: () => trpcUtils.traces.newCount.invalidate(),
      });
    }
    prevVisibleRef.current = isVisible;
  }, [isVisible, refresh, trpcUtils]);

  const liveUpdatesMode = useSseStatusStore((s) => s.liveUpdatesMode);

  // Aurora refresh pulse is now scoped to "trace about to appear" — fires
  // once when the count transitions from 0 to >0 in live mode, signalling
  // to the user that the list is being merged with new rows. In ask mode
  // the user opted to gate merges behind the floating pill click, so we
  // stay quiet there; the pill itself is the signal.
  const pulseRefresh = useRefreshUIStore((s) => s.pulse);
  // `null` = no baseline yet for the current query identity. Reset
  // whenever the identity (project / time range / search / since)
  // changes so a count from one context never gets compared against a
  // count from another — that comparison can spuriously fire or
  // suppress the 0→N pulse.
  const prevCountRef = useRef<number | null>(null);
  const { evalRuns } = useInstantEvalRuns();
  useEffect(() => {
    prevCountRef.current = null;
    // A run registering for a chip changes what is counted, so the baseline
    // belongs to the query identity the same way the search text does.
  }, [project?.id, timeRange.from, timeRange.to, timeRange.label, since, queryText, evalRuns]);

  const query = api.traces.newCount.useQuery(
    newCountQueryInput({ projectId: project?.id, timeRange, since, queryText, evalRuns }),
    {
      // Honour the store contract: paused = "no updates, no pill". Stops the
      // query from firing at all.
      enabled: !!project?.id && liveUpdatesMode !== "paused",
      staleTime: 0,
      // A failing count is almost always ClickHouse easing us off under
      // concurrent load. One client-side retry is enough.
      retry: 1,
    },
  );

  // Per-fetch success handling. Keyed on `dataUpdatedAt`, NOT on `data`:
  // structural sharing keeps `data` identity stable across reads returning
  // the same count.
  const { data: countData, dataUpdatedAt } = query;
  useEffect(() => {
    if (!dataUpdatedAt || !countData) return;
    // Fire the aurora pulse only on the 0→N transition in live
    // mode. Ask mode stays quiet (the floating pill is the
    // operator's chosen signal). High-throughput projects no longer
    // see the pulse loop every SSE event — it now correlates with
    // an actual UI change (new rows are about to land).
    const prev = prevCountRef.current;
    prevCountRef.current = countData.count;
    if (isFirstLiveArrival({ prev, count: countData.count })) {
      pulseRefresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataUpdatedAt]);

  const acknowledge = useCallback(() => {
    setSince(nowInstant().epochMilliseconds);
    refresh();
  }, [refresh]);

  return {
    count: query.data?.count ?? 0,
    isLoading: query.isLoading,
    acknowledge,
  };
}
