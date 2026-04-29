import { useCallback, useEffect, useRef, useState } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePageVisibility } from "~/hooks/usePageVisibility";
import { api } from "~/utils/api";
import { useFilterStore } from "../stores/filterStore";
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

  // Reset to fast polling when tab becomes visible again, and surface
  // any traces that arrived while we were away by invalidating the list.
  const prevVisibleRef = useRef(isVisible);
  useEffect(() => {
    if (isVisible && !prevVisibleRef.current) {
      consecutiveZerosRef.current = 0;
      setIntervalMs(FAST_MS);
      refresh();
    }
    prevVisibleRef.current = isVisible;
  }, [isVisible, refresh]);

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
      enabled: !!project?.id,
      staleTime: 0,
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
