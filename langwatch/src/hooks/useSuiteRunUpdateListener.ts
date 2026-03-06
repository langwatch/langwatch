import { useCallback, useEffect, useMemo, useRef } from "react";
import { api } from "~/utils/api";
import { usePageVisibility } from "./usePageVisibility";
import { useSSESubscription } from "./useSSESubscription";

interface SuiteRunUpdateFilter {
  suiteId?: string;
  batchRunId?: string;
  setId?: string;
}

interface UseSuiteRunUpdateListenerOptions {
  projectId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  refetch?: () => any;
  enabled?: boolean;
  debounceMs?: number;
  filter?: SuiteRunUpdateFilter;
}

interface SuiteRunBroadcastPayload {
  event: string;
  suiteId?: string;
  batchRunId?: string;
  setId?: string;
  status?: string;
  progress?: number;
  total?: number;
}

/**
 * Hook for subscribing to real-time suite run updates via tRPC subscriptions.
 * Supports filtering by suiteId, batchRunId, or setId.
 *
 * Uses a "first-instant-then-debounce" pattern: the first SSE event triggers an
 * immediate refetch, subsequent events within `debounceMs` are coalesced.
 */
export function useSuiteRunUpdateListener({
  projectId,
  refetch,
  enabled = true,
  debounceMs = 500,
  filter,
}: UseSuiteRunUpdateListenerOptions) {
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFireRef = useRef<number>(0);
  const isVisible = usePageVisibility();
  const trpcUtils = api.useContext();

  const shouldProcessUpdate = useMemo(() => {
    if (!isVisible) return false;
    return true;
  }, [isVisible]);

  const matchesFilter = useCallback(
    (payload: SuiteRunBroadcastPayload): boolean => {
      if (!filter) return true;
      if (filter.suiteId && payload.suiteId !== filter.suiteId) return false;
      if (filter.batchRunId && payload.batchRunId !== filter.batchRunId) return false;
      if (filter.setId && payload.setId !== filter.setId) return false;
      return true;
    },
    [filter],
  );

  const fireUpdate = useCallback(() => {
    if (!shouldProcessUpdate) return;

    void trpcUtils.suites.getQueueStatus.invalidate();

    if (refetch) {
      void refetch();
    }
  }, [shouldProcessUpdate, refetch, trpcUtils]);

  const scheduleUpdate = useCallback(() => {
    const now = Date.now();
    const elapsed = now - lastFireRef.current;

    if (elapsed >= debounceMs) {
      lastFireRef.current = now;
      fireUpdate();
      return;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      lastFireRef.current = Date.now();
      debounceTimerRef.current = null;
      fireUpdate();
    }, debounceMs - elapsed);
  }, [debounceMs, fireUpdate]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  useSSESubscription<
    { event: string; timestamp: number },
    { projectId: string }
  >(
    // @ts-expect-error - tRPC subscription type is not compatible with the useSSESubscription hook
    api.suites.onSuiteRunUpdate,
    { projectId },
    {
      enabled: Boolean(enabled && projectId),
      onData: (data) => {
        if (data.event) {
          try {
            const payload: SuiteRunBroadcastPayload =
              typeof data.event === "string" ? JSON.parse(data.event) : data.event;

            if (payload.event === "suite_run_updated" && matchesFilter(payload)) {
              scheduleUpdate();
            }
          } catch {
            scheduleUpdate();
          }
        }
      },
    },
  );
}
