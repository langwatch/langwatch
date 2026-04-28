import { useCallback, useEffect, useRef, useState } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePageVisibility } from "~/hooks/usePageVisibility";
import { api } from "~/utils/api";
import { useFilterStore } from "../stores/filterStore";
import { useFreshnessSignal } from "../stores/freshnessSignal";

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
  const timeRange = useFilterStore((s) => s.timeRange);
  const queryText = useFilterStore((s) => s.queryText);
  const [since, setSince] = useState(() => Date.now());
  const refresh = useFreshnessSignal((s) => s.refresh);

  const isVisible = usePageVisibility();
  const [intervalMs, setIntervalMs] = useState(FAST_MS);
  const consecutiveZerosRef = useRef(0);

  // Reset to fast polling when SSE events signal new data
  const fastPollRequestedAt = useFreshnessSignal((s) => s.fastPollRequestedAt);
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
      refresh?.();
    }
    prevVisibleRef.current = isVisible;
  }, [isVisible, refresh]);

  const query = api.tracesV2.newCount.useQuery(
    {
      projectId: project?.id ?? "",
      timeRange: { from: timeRange.from, to: timeRange.to, live: !!timeRange.label },
      since,
      query: queryText || undefined,
    },
    {
      enabled: !!project?.id,
      staleTime: 0,
      refetchInterval: isVisible ? intervalMs : false,
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
    refresh?.();
  }, [refresh]);

  return {
    count: query.data?.count ?? 0,
    isLoading: query.isLoading,
    acknowledge,
  };
}
