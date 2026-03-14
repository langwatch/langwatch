import { useCallback, useEffect, useRef } from "react";
import {
  isCompactStreamingEvent,
  type CompactStreamingEvent,
} from "~/utils/streaming-event-codec";
import { api } from "~/utils/api";
import { createLogger } from "~/utils/logger";
import { usePageVisibility } from "./usePageVisibility";
import { useSSESubscription } from "./useSSESubscription";

const logger = createLogger("useSimulationUpdateListener");

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
  onStreamingEvent?: (payload: CompactStreamingEvent) => void;
}

export interface SimulationBroadcastPayload {
  event: string;
  scenarioRunId?: string;
  batchRunId?: string;
  scenarioSetId?: string;
  status?: string;
}

export function useSimulationUpdateListener({
  projectId,
  refetch,
  enabled = true,
  debounceMs = 500,
  filter,
  onNewBatchRun,
  onStreamingEvent,
}: UseSimulationUpdateListenerOptions) {
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFireRef = useRef<number>(0);
  const isVisible = usePageVisibility();
  const trpcUtils = api.useContext();
  const knownBatchRunIdsRef = useRef<Set<string>>(new Set());

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
    if (!isVisible) return;

    void trpcUtils.scenarios.getScenarioSetBatchHistory.invalidate();
    // Invalidate suite run data queries so RunHistoryPanel refreshes
    void trpcUtils.scenarios.getSuiteRunData.invalidate();

    // Don't blanket-invalidate getRunState — each card polls independently
    // and receives streaming data via the event bus. Blanket invalidation
    // causes N simultaneous refetches (one per card) on every SSE event.
    if (refetch) {
      void refetch();
    }
  }, [isVisible, refetch, trpcUtils]);

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
    api.scenarios.onSimulationUpdate,
    { projectId },
    {
      enabled: Boolean(enabled && projectId),
      onData: (data) => {
        if (!data.event) return;

        try {
          const parsed =
            typeof data.event === "string" ? JSON.parse(data.event) : data.event;

          // Compact streaming events: { e: "S"|"C"|"E", r, b, m, ... }
          if (isCompactStreamingEvent(parsed)) {
            if (filter?.batchRunId && parsed.b !== filter.batchRunId) return;
            if (filter?.scenarioRunId && parsed.r !== filter.scenarioRunId) return;

            if (onStreamingEvent) {
              onStreamingEvent(parsed);
              return;
            }
            // No streaming handler: skip CONTENT, refetch for START/END
            if (parsed.e === "C") return;
            scheduleUpdate();
            return;
          }

          // Non-streaming events: { event: "simulation_updated", ... }
          const payload = parsed as SimulationBroadcastPayload;
          if (!matchesFilter(payload)) return;

          if (payload.event === "simulation_updated") {
            // Selective invalidation: only the affected card refetches,
            // not all N cards like the old blanket invalidation did.
            if (payload.scenarioRunId) {
              void trpcUtils.scenarios.getRunState.invalidate({
                scenarioRunId: payload.scenarioRunId,
              });
            }

            scheduleUpdate();

            if (payload.batchRunId && onNewBatchRun) {
              if (!knownBatchRunIdsRef.current.has(payload.batchRunId)) {
                knownBatchRunIdsRef.current.add(payload.batchRunId);
                if (knownBatchRunIdsRef.current.size > 500) {
                  knownBatchRunIdsRef.current.clear();
                  knownBatchRunIdsRef.current.add(payload.batchRunId);
                }
                onNewBatchRun(payload.batchRunId);
              }
            }
          }
        } catch (err) {
          logger.warn({ err }, "Failed to parse SSE event");
          scheduleUpdate();
        }
      },
    },
  );
}
