import { useCallback, useEffect, useMemo, useRef } from "react";
import { api } from "~/utils/api";
import { usePageVisibility } from "./usePageVisibility";
import { useSSESubscription } from "./useSSESubscription";

interface SimulationUpdateFilter {
  scenarioRunId?: string;
  batchRunId?: string;
  scenarioSetId?: string;
}

interface UseSimulationUpdateListenerOptions {
  projectId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  refetch?: () => any;
  enabled?: boolean;
  debounceMs?: number;
  filter?: SimulationUpdateFilter;
  onNewBatchRun?: (batchRunId: string) => void;
}

interface SimulationBroadcastPayload {
  event: string;
  scenarioRunId?: string;
  batchRunId?: string;
  scenarioSetId?: string;
  status?: string;
}

/**
 * Hook for subscribing to real-time simulation updates via tRPC subscriptions.
 * Supports aggregate-level filtering so pages only refetch when their specific data changed.
 *
 * Uses a "first-instant-then-debounce" pattern: the first SSE event triggers an
 * immediate refetch, subsequent events within `debounceMs` are coalesced.
 *
 * @param options.projectId - The project/tenant ID to subscribe to
 * @param options.refetch - Function to call when simulation data is updated
 * @param options.enabled - Whether the subscription should be active (default: true)
 * @param options.debounceMs - Debounce delay for subsequent events (default: 500). First event is always immediate.
 * @param options.filter - Optional filter to only refetch when specific IDs match
 * @param options.onNewBatchRun - Optional callback when a new batch run is detected
 */
export function useSimulationUpdateListener({
  projectId,
  refetch,
  enabled = true,
  debounceMs = 500,
  filter,
  onNewBatchRun,
}: UseSimulationUpdateListenerOptions) {
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFireRef = useRef<number>(0);
  const isVisible = usePageVisibility();
  const trpcUtils = api.useContext();
  const knownBatchRunIdsRef = useRef<Set<string>>(new Set());

  const shouldProcessUpdate = useMemo(() => {
    if (!isVisible) return false;
    return true;
  }, [isVisible]);

  const matchesFilter = useCallback(
    (payload: SimulationBroadcastPayload): boolean => {
      if (!filter) return true;
      if (filter.scenarioRunId && payload.scenarioRunId !== filter.scenarioRunId) return false;
      if (filter.batchRunId && payload.batchRunId !== filter.batchRunId) return false;
      if (filter.scenarioSetId && payload.scenarioSetId !== filter.scenarioSetId) return false;
      return true;
    },
    [filter],
  );

  const fireUpdate = useCallback(() => {
    if (!shouldProcessUpdate) return;

    // Invalidate sidebar batch history queries so they refetch too
    void trpcUtils.scenarios.getScenarioSetBatchHistory.invalidate();

    if (refetch) {
      void refetch();
    }
  }, [shouldProcessUpdate, refetch, trpcUtils]);

  const scheduleUpdate = useCallback(() => {
    const now = Date.now();
    const elapsed = now - lastFireRef.current;

    // First event (or after debounce window has fully elapsed): fire immediately
    if (elapsed >= debounceMs) {
      lastFireRef.current = now;
      fireUpdate();
      return;
    }

    // Subsequent events within debounce window: coalesce
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
    api.scenarios.onSimulationUpdate,
    { projectId },
    {
      enabled: Boolean(enabled && projectId),
      onData: (data) => {
        if (data.event) {
          try {
            const payload: SimulationBroadcastPayload =
              typeof data.event === "string" ? JSON.parse(data.event) : data.event;

            if (payload.event === "simulation_updated" && matchesFilter(payload)) {
              scheduleUpdate();

              // Detect new batch runs for prefetching
              if (payload.batchRunId && onNewBatchRun) {
                if (!knownBatchRunIdsRef.current.has(payload.batchRunId)) {
                  knownBatchRunIdsRef.current.add(payload.batchRunId);
                  onNewBatchRun(payload.batchRunId);
                }
              }
            }
          } catch {
            // If payload isn't JSON, treat as a generic simulation update
            scheduleUpdate();
          }
        }
      },
    },
  );
}
