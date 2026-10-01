import { nowInstant } from "@langwatch/time";
import { usePageVisibility, useFilterStore } from "@langwatch/trace-browser-kit";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { useRefreshUIStore } from "../../../../behavior/refresh-ui.store.ts";
import { useSseStatusStore } from "../../../../behavior/sse-status.store.ts";
import { api } from "../../../../behavior/trace-api.ts";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";
import { useInstantEvalRuns } from "./use-instant-eval-runs.ts";
import { useTraceListRefresh } from "./use-trace-list-refresh.ts";

const FAST_MS = 5_000;
const SLOW_MS = 30_000;
const IDLE_MS = 120_000;
const BACKOFF_THRESHOLD = 3;

interface TraceNewCountResult {
  count: number;
  isLoading: boolean;
  /** Reset the count to 0 (advances `since` to now) and pulls the latest list. */
  acknowledge: () => void;
}

function nextBackoffInterval(consecutiveZeros: number, current: number): number {
  if (consecutiveZeros >= BACKOFF_THRESHOLD * 2 && current < IDLE_MS) {
    return IDLE_MS;
  }
  if (consecutiveZeros >= BACKOFF_THRESHOLD && current < SLOW_MS) {
    return SLOW_MS;
  }
  return current;
}

// What a tab returning to view refetches depends on the operator's live-updates mode.
function resumeLiveUpdates({
  resetPolling,
  refresh,
  invalidateCount,
}: {
  resetPolling: () => void;
  refresh: () => void;
  invalidateCount: () => Promise<void>;
}): void {
  const mode = useSseStatusStore.getState().liveUpdatesMode;
  if (mode !== "paused") resetPolling();
  if (mode === "live") {
    refresh();
    return;
  }
  if (mode === "ask") void invalidateCount();
}

// Every zero-count poll steps the backoff; any new trace returns to the fast cadence.
function stepZeroBackoff({
  count,
  consecutiveZeros,
  setIntervalMs,
}: {
  count: number;
  consecutiveZeros: { current: number };
  setIntervalMs: Dispatch<SetStateAction<number>>;
}): void {
  if (count !== 0) {
    consecutiveZeros.current = 0;
    setIntervalMs(FAST_MS);
    return;
  }
  consecutiveZeros.current += 1;
  setIntervalMs((current) => nextBackoffInterval(consecutiveZeros.current, current));
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
  const [intervalMs, setIntervalMs] = useState(FAST_MS);
  const consecutiveZerosRef = useRef(0);

  // SSE is the primary freshness signal. When it's connected, the listener
  // in useTraceFreshness invalidates this query as soon as data changes,
  // so polling is unnecessary. We only fall back to polling when SSE is
  // unavailable (connecting / disconnected / error).
  const sseConnectionState = useSseStatusStore((s) => s.sseConnectionState);
  const sseConnected = sseConnectionState === "connected";

  // Reset to fast polling when SSE events signal new data
  const fastPollRequestedAt = useSseStatusStore((s) => s.fastPollRequestedAt);
  useEffect(() => {
    if (fastPollRequestedAt === 0) return;
    consecutiveZerosRef.current = 0;
    setIntervalMs(FAST_MS);
  }, [fastPollRequestedAt]);

  // Reset to fast polling when tab becomes visible again. What we refetch depends on
  // the operator's live-updates mode:
  const trpcUtils = api.useUtils();
  const prevVisibleRef = useRef(isVisible);
  useEffect(() => {
    if (isVisible && !prevVisibleRef.current) {
      resumeLiveUpdates({
        resetPolling: () => {
          consecutiveZerosRef.current = 0;
          setIntervalMs(FAST_MS);
        },
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
      // Honour the store contract: paused = "no updates, no pill, no
      // polling". Stops the query from firing at all so a paused
      // operator can leave the tab without burning quota on count
      // pings they explicitly turned off.
      enabled: !!project?.id && liveUpdatesMode !== "paused",
      staleTime: 0,
      // A failing poll is almost always ClickHouse easing us off under
      // concurrent load. One client-side retry is enough; the refetch
      // interval (backed off in onError) will try again shortly.
      retry: 1,
      refetchInterval: isVisible && !sseConnected ? intervalMs : false,
    },
  );

  // Per-fetch success handling. Keyed on `dataUpdatedAt`, NOT on `data`:
  // structural sharing keeps `data` identity stable across polls returning
  // the same count, and the zero-backoff must step on every poll.
  const { data: countData, dataUpdatedAt, errorUpdatedAt } = query;
  useEffect(() => {
    if (!dataUpdatedAt || !countData) return;
    stepZeroBackoff({
      count: countData.count,
      consecutiveZeros: consecutiveZerosRef,
      setIntervalMs,
    });
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

  useEffect(() => {
    if (!errorUpdatedAt) return;
    // Ease off when the count query fails (typically ClickHouse
    // "Too many simultaneous queries" under load) so the client does
    // not amplify the storm with fast polling. Recovers to the fast
    // cadence on the next successful poll or SSE fast-poll signal.
    setIntervalMs(SLOW_MS);
  }, [errorUpdatedAt]);

  const acknowledge = useCallback(() => {
    setSince(nowInstant().epochMilliseconds);
    consecutiveZerosRef.current = 0;
    setIntervalMs(FAST_MS);
    refresh();
  }, [refresh]);

  return {
    count: query.data?.count ?? 0,
    isLoading: query.isLoading,
    acknowledge,
  };
}
