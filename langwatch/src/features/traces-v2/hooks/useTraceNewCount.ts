import { useCallback, useEffect, useRef, useState } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePageVisibility } from "~/hooks/usePageVisibility";
import { api } from "~/utils/api";
import { useFilterStore } from "../stores/filterStore";
import { useRefreshUIStore } from "../stores/refreshUIStore";
import { useSseStatusStore } from "../stores/sseStatusStore";
import { useTraceListRefresh } from "./useTraceListRefresh";

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

function nextBackoffInterval(
  consecutiveZeros: number,
  current: number,
): number {
  if (consecutiveZeros >= BACKOFF_THRESHOLD * 2 && current < IDLE_MS) {
    return IDLE_MS;
  }
  if (consecutiveZeros >= BACKOFF_THRESHOLD && current < SLOW_MS) {
    return SLOW_MS;
  }
  return current;
}

export function useTraceNewCount(): TraceNewCountResult {
  const { project } = useOrganizationTeamProject();
  const timeRange = useFilterStore((s) => s.debouncedTimeRange);
  const queryText = useFilterStore((s) => s.debouncedQueryText);
  const [since, setSince] = useState(() => Date.now());
  const refresh = useTraceListRefresh();

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

  // Reset to fast polling when tab becomes visible again. What we
  // refetch depends on the operator's live-updates mode:
  //
  //   live   — full refresh: list + discover + newCount, so the table
  //            reflects whatever arrived while we were away.
  //   ask    — newCount only; the user explicitly opted *out* of
  //            silent list merges, so we just update the (N new) pill
  //            and let them click it to commit.
  //   paused — do nothing; "no updates, no pill, no polling" per the
  //            store's contract.
  const trpcUtils = api.useContext();
  const prevVisibleRef = useRef(isVisible);
  useEffect(() => {
    if (isVisible && !prevVisibleRef.current) {
      const mode = useSseStatusStore.getState().liveUpdatesMode;
      if (mode !== "paused") {
        consecutiveZerosRef.current = 0;
        setIntervalMs(FAST_MS);
      }
      if (mode === "live") {
        refresh();
      } else if (mode === "ask") {
        void trpcUtils.tracesV2.newCount.invalidate();
      }
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
  useEffect(() => {
    prevCountRef.current = null;
  }, [
    project?.id,
    timeRange.from,
    timeRange.to,
    timeRange.label,
    since,
    queryText,
  ]);

  const query = api.tracesV2.newCount.useQuery(
    {
      projectId: project?.id ?? "",
      timeRange: {
        from: timeRange.from,
        to: timeRange.to,
        live: !!timeRange.label,
      },
      since,
      query: queryText || undefined,
    },
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
      onSuccess: (data) => {
        if (data.count === 0) {
          consecutiveZerosRef.current += 1;
          setIntervalMs((current) =>
            nextBackoffInterval(consecutiveZerosRef.current, current),
          );
        } else {
          consecutiveZerosRef.current = 0;
          setIntervalMs(FAST_MS);
        }
        // Fire the aurora pulse only on the 0→N transition in live
        // mode. Ask mode stays quiet (the floating pill is the
        // operator's chosen signal). High-throughput projects no longer
        // see the pulse loop every SSE event — it now correlates with
        // an actual UI change (new rows are about to land).
        const prev = prevCountRef.current;
        prevCountRef.current = data.count;
        if (
          prev === 0 &&
          data.count > 0 &&
          useSseStatusStore.getState().liveUpdatesMode === "live"
        ) {
          // First success in a new query context (prev === null) is
          // baseline only — never pulses.
          pulseRefresh();
        }
      },
      onError: () => {
        // Ease off when the count query fails (typically ClickHouse
        // "Too many simultaneous queries" under load) so the client does
        // not amplify the storm with fast polling. Recovers to the fast
        // cadence on the next successful poll or SSE fast-poll signal.
        setIntervalMs(SLOW_MS);
      },
    },
  );

  const acknowledge = useCallback(() => {
    setSince(Date.now());
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
