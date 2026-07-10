import { useCallback, useEffect, useRef, useState } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePageVisibility } from "~/hooks/usePageVisibility";
import { api } from "~/utils/api";
import { useLangySseStatusStore } from "../stores/langySseStatusStore";

const FAST_MS = 5_000;
const SLOW_MS = 30_000;
const IDLE_MS = 120_000;
const BACKOFF_THRESHOLD = 3;

export interface LangyNewCountResult {
  count: number;
  isLoading: boolean;
  /** Reset the count to 0 (advances `since` to now). */
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

/**
 * Count of conversations touched since the panel opened — the "N new" pill.
 *
 * Mirrors `useTraceNewCount`: SSE is the primary freshness signal, so while
 * it's connected the query does NOT poll (the freshness coordinator keeps it
 * fresh via invalidation). When SSE is unavailable, it falls back to adaptive
 * polling that backs off (fast -> slow -> idle) as consecutive polls come back
 * empty, and resets to fast on an SSE fast-poll signal or tab re-focus.
 */
export function useLangyNewCount(): LangyNewCountResult {
  const { project } = useOrganizationTeamProject();
  const [since, setSince] = useState(() => Date.now());
  const isVisible = usePageVisibility();
  const [intervalMs, setIntervalMs] = useState(FAST_MS);
  const consecutiveZerosRef = useRef(0);

  const sseConnectionState = useLangySseStatusStore(
    (s) => s.sseConnectionState,
  );
  const sseConnected = sseConnectionState === "connected";

  const fastPollRequestedAt = useLangySseStatusStore(
    (s) => s.fastPollRequestedAt,
  );
  useEffect(() => {
    if (fastPollRequestedAt === 0) return;
    consecutiveZerosRef.current = 0;
    setIntervalMs(FAST_MS);
  }, [fastPollRequestedAt]);

  const prevVisibleRef = useRef(isVisible);
  useEffect(() => {
    if (isVisible && !prevVisibleRef.current) {
      consecutiveZerosRef.current = 0;
      setIntervalMs(FAST_MS);
    }
    prevVisibleRef.current = isVisible;
  }, [isVisible]);

  const query = api.langy.newCount.useQuery(
    { projectId: project?.id ?? "", since },
    {
      enabled: !!project?.id,
      staleTime: 0,
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
      },
      onError: () => {
        // Ease off on failure so the client doesn't amplify load.
        setIntervalMs(SLOW_MS);
      },
    },
  );

  const acknowledge = useCallback(() => {
    setSince(Date.now());
    consecutiveZerosRef.current = 0;
    setIntervalMs(FAST_MS);
  }, []);

  return {
    count: query.data?.count ?? 0,
    isLoading: query.isLoading,
    acknowledge,
  };
}
