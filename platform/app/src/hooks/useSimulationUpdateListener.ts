import { createLogger } from "@langwatch/observability";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  isScenarioTabNavigatePayload,
  type ScenarioTabNavigatePayload,
} from "~/server/scenarios/browser-tab/scenario-tab-events";
import { DEFAULT_SET_ID } from "~/server/scenarios/internal-set-id";
import {
  isTerminalStatus,
  type ScenarioRunStatus,
} from "~/server/scenarios/scenario-event.enums";
import { api } from "~/utils/api";
import {
  type CompactStreamingEvent,
  isCompactStreamingEvent,
} from "~/utils/streaming-event-codec";
import { usePageVisibility } from "./usePageVisibility";
import { useSSESubscription } from "./useSSESubscription";

const logger = createLogger("useSimulationUpdateListener");

const normalizeSetId = (id: string | undefined): string =>
  !id ? DEFAULT_SET_ID : id;

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
  /**
   * Registers this tab as reusable for the given machine key while the
   * subscription is open. Only the page-level listener should pass these —
   * they are what lets the SDK skip opening another browser tab.
   */
  tabKey?: string | null;
  tabId?: string | null;
  onTabNavigate?: (payload: ScenarioTabNavigatePayload) => void;
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
  tabKey,
  tabId,
  onTabNavigate,
}: UseSimulationUpdateListenerOptions) {
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFireRef = useRef<number>(0);
  /**
   * At least one update arrived while the tab was hidden.
   *
   * A boolean is enough because the flush refetches current state rather than
   * replaying events: whether one update or fifty were missed, the work to
   * catch up is the same single refresh, so there is nothing to count or
   * queue.
   */
  const missedWhileHiddenRef = useRef(false);
  const isVisible = usePageVisibility();
  const trpcUtils = api.useUtils();
  const knownBatchRunIdsRef = useRef<Set<string>>(new Set());

  const matchesFilter = useCallback(
    (payload: SimulationBroadcastPayload): boolean => {
      if (!filter) return true;
      if (
        filter.scenarioRunId &&
        payload.scenarioRunId !== filter.scenarioRunId
      )
        return false;
      if (filter.batchRunId && payload.batchRunId !== filter.batchRunId)
        return false;
      if (
        filter.scenarioSetId &&
        normalizeSetId(payload.scenarioSetId) !==
          normalizeSetId(filter.scenarioSetId)
      )
        return false;
      return true;
    },
    [filter],
  );

  const fireUpdate = useCallback(() => {
    // Hidden tabs defer rather than drop. A dropped update is never retried —
    // the broadcast that would have refreshed this run has already been and
    // gone — so a run that finished while you were on another tab stayed
    // "running" until the page was reloaded by hand.
    if (!isVisible) {
      missedWhileHiddenRef.current = true;
      return;
    }

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

  /**
   * Refetch the run, then apply the status the event carried.
   *
   * The refetch alone is not enough for a terminal event. The broadcast can
   * beat the fold commit, so the refetch can read back the pre-terminal row —
   * and `finished` is the last event, so no later broadcast arrives to correct
   * it. That is what left cards sitting on "running" until a manual reload.
   *
   * The event is authoritative here: it carries the terminal status as
   * event-carried state, which is exactly why the broadcast includes it. So
   * the status is stamped AFTER the refetch settles, and only over a
   * non-terminal cached value, so a settled read is never downgraded.
   */
  const applyRunUpdate = useCallback(
    async ({
      scenarioRunId,
      status,
    }: {
      scenarioRunId: string;
      status: string | undefined;
    }) => {
      await trpcUtils.scenarios.getRunState.invalidate({ scenarioRunId });

      if (!status || !isTerminalStatus(status as ScenarioRunStatus)) return;

      trpcUtils.scenarios.getRunState.setData(
        { projectId, scenarioRunId },
        (previous) =>
          previous && !isTerminalStatus(previous.status)
            ? { ...previous, status: status as ScenarioRunStatus }
            : previous,
      );
    },
    [projectId, trpcUtils],
  );

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

  // Flush whatever arrived while the tab was hidden. Without this the deferral
  // above would just be a slower drop.
  useEffect(() => {
    if (!isVisible || !missedWhileHiddenRef.current) return;
    missedWhileHiddenRef.current = false;
    fireUpdate();
  }, [isVisible, fireUpdate]);

  const subscriptionInput = useMemo(
    () => (tabKey && tabId ? { projectId, tabKey, tabId } : { projectId }),
    [projectId, tabId, tabKey],
  );

  const subscription = useSSESubscription<
    { event: string; timestamp: number },
    { projectId: string; tabKey?: string; tabId?: string }
  >(
    // @ts-expect-error - tRPC subscription type is not compatible with the useSSESubscription hook
    api.scenarios.onSimulationUpdate,
    subscriptionInput,
    {
      enabled: Boolean(enabled && projectId),
      onData: (data) => {
        if (!data.event) return;

        try {
          const parsed =
            typeof data.event === "string"
              ? JSON.parse(data.event)
              : data.event;

          // Tab handoffs address a machine, not a run, so they are matched on
          // the tab key alone and never against the run/batch filter below.
          if (isScenarioTabNavigatePayload(parsed)) {
            if (onTabNavigate && tabKey && parsed.tabKey === tabKey) {
              onTabNavigate(parsed);
            }
            return;
          }

          // Compact streaming events: { e: "S"|"C"|"E", r, b, m, ... }
          if (isCompactStreamingEvent(parsed)) {
            if (filter?.batchRunId && parsed.b !== filter.batchRunId) return;
            if (filter?.scenarioRunId && parsed.r !== filter.scenarioRunId)
              return;

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
              void applyRunUpdate({
                scenarioRunId: payload.scenarioRunId,
                status: payload.status,
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

  // Callers use the connection state to disable fallback polling while the
  // event stream is healthy — SSE is the primary freshness signal, polling
  // exists only for disconnected sessions.
  return {
    connectionState: subscription.connectionState,
    isConnected: subscription.isConnected,
  } as const;
}
