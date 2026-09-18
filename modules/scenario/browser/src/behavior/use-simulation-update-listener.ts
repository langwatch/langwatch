import { createLogger } from "@langwatch/observability/browser";
import {
  isScenarioTabNavigatePayload,
  type ScenarioTabNavigatePayload,
  DEFAULT_SET_ID,
  isTerminalStatus,
  ScenarioRunStatus,
  type CompactStreamingEvent,
  isCompactStreamingEvent,
} from "@langwatch/scenario-contract";
import { nowInstant } from "@langwatch/time";
import { usePageVisibility, useSSESubscription } from "@langwatch/trace-browser-kit";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { z } from "zod";

import { api } from "./scenario-api.ts";

const logger = createLogger("useSimulationUpdateListener");

const normalizeSetId = (id: string | undefined): string => (!id ? DEFAULT_SET_ID : id);

interface SimulationUpdateFilter {
  scenarioRunId?: string;
  batchRunId?: string;
  scenarioSetId?: string;
}

interface UseSimulationUpdateListenerOptions {
  projectId: string;
  refetch?: () => unknown;
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

/**
 * Records `batchRunId` as seen, and reports whether it was new — bounding the
 * tracked set so a long-lived listener doesn't grow it unbounded, at the cost
 * of occasionally re-announcing a batch after the set resets.
 */
function recordNewBatchRunId(batchRunId: string, knownIds: Set<string>, maxTracked = 500): boolean {
  if (knownIds.has(batchRunId)) {
    return false;
  }
  knownIds.add(batchRunId);
  if (knownIds.size > maxTracked) {
    knownIds.clear();
    knownIds.add(batchRunId);
  }
  return true;
}

function matchesSimulationFilter(
  payload: SimulationBroadcastPayload,
  filter: SimulationUpdateFilter | undefined,
): boolean {
  if (!filter) return true;
  if (filter.scenarioRunId && payload.scenarioRunId !== filter.scenarioRunId) return false;
  if (filter.batchRunId && payload.batchRunId !== filter.batchRunId) return false;
  if (
    filter.scenarioSetId &&
    normalizeSetId(payload.scenarioSetId) !== normalizeSetId(filter.scenarioSetId)
  )
    return false;
  return true;
}

const simulationBroadcastSchema = z.object({
  event: z.string(),
  scenarioRunId: z.string().optional(),
  batchRunId: z.string().optional(),
  scenarioSetId: z.string().optional(),
  status: z.string().optional(),
});

type SimulationEventActions = {
  filter: SimulationUpdateFilter | undefined;
  tabKey: string | null | undefined;
  onTabNavigate: UseSimulationUpdateListenerOptions["onTabNavigate"];
  onStreamingEvent: UseSimulationUpdateListenerOptions["onStreamingEvent"];
  onNewBatchRun: UseSimulationUpdateListenerOptions["onNewBatchRun"];
  knownBatchRunIds: Set<string>;
  scheduleUpdate: () => void;
  applyRunUpdate: (input: { scenarioRunId: string; status: string | undefined }) => Promise<void>;
};

function handleStreamingEvent(payload: CompactStreamingEvent, actions: SimulationEventActions) {
  if (actions.filter?.batchRunId && payload.b !== actions.filter.batchRunId) return;
  if (actions.filter?.scenarioRunId && payload.r !== actions.filter.scenarioRunId) return;
  if (actions.onStreamingEvent) {
    actions.onStreamingEvent(payload);
    return;
  }
  // Without a streaming consumer, START and END refresh the stored run.
  if (payload.e !== "C") actions.scheduleUpdate();
}

function handleBroadcastUpdate(
  payload: SimulationBroadcastPayload,
  actions: SimulationEventActions,
) {
  if (!matchesSimulationFilter(payload, actions.filter)) return;
  if (payload.event !== "simulation_updated") return;
  if (payload.scenarioRunId) {
    void actions.applyRunUpdate({ scenarioRunId: payload.scenarioRunId, status: payload.status });
  }
  actions.scheduleUpdate();
  if (
    payload.batchRunId &&
    actions.onNewBatchRun &&
    recordNewBatchRunId(payload.batchRunId, actions.knownBatchRunIds)
  ) {
    actions.onNewBatchRun(payload.batchRunId);
  }
}

function handleSimulationEvent(event: string, actions: SimulationEventActions) {
  if (!event) return;
  try {
    const parsed: unknown = typeof event === "string" ? JSON.parse(event) : event;
    // Tab handoffs address a machine, independently of run and batch filters.
    if (isScenarioTabNavigatePayload(parsed)) {
      if (actions.tabKey && parsed.tabKey === actions.tabKey) {
        actions.onTabNavigate?.(parsed);
      }
      return;
    }
    if (isCompactStreamingEvent(parsed)) {
      handleStreamingEvent(parsed, actions);
      return;
    }
    const payload = simulationBroadcastSchema.safeParse(parsed);
    if (payload.success) handleBroadcastUpdate(payload.data, actions);
  } catch (err) {
    logger.warn({ err }, "Failed to parse SSE event");
    actions.scheduleUpdate();
  }
}

function useSimulationRefresh(refetch: (() => unknown) | undefined) {
  /**
   * At least one update arrived while the tab was hidden.
   */
  const missedWhileHiddenRef = useRef(false);
  const isVisible = usePageVisibility();
  const trpcUtils = api.useUtils();

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

  // Flush whatever arrived while the tab was hidden. Without this the deferral
  // above would just be a slower drop.
  useEffect(() => {
    if (!isVisible || !missedWhileHiddenRef.current) return;
    missedWhileHiddenRef.current = false;
    fireUpdate();
  }, [isVisible, fireUpdate]);

  return fireUpdate;
}

function useRunUpdate(projectId: string) {
  const trpcUtils = api.useUtils();
  /**
   * Refetch the run, then apply the status the event carried.
   */
  const applyRunUpdate = useCallback(
    async ({ scenarioRunId, status }: { scenarioRunId: string; status: string | undefined }) => {
      await trpcUtils.scenarios.getRunState.invalidate({ scenarioRunId });

      const parsedStatus = z.enum(ScenarioRunStatus).safeParse(status);
      if (!parsedStatus.success || !isTerminalStatus(parsedStatus.data)) return;

      trpcUtils.scenarios.getRunState.setData(
        { projectId, scenarioRunId },
        (previous: { status: ScenarioRunStatus } | undefined) =>
          previous && !isTerminalStatus(previous.status)
            ? { ...previous, status: parsedStatus.data }
            : previous,
      );
    },
    [projectId, trpcUtils],
  );

  return applyRunUpdate;
}

function useDebouncedUpdate(fireUpdate: () => void, debounceMs: number) {
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFireRef = useRef<number>(0);
  const scheduleUpdate = useCallback(() => {
    const now = nowInstant().epochMilliseconds;
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
      lastFireRef.current = nowInstant().epochMilliseconds;
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

  return scheduleUpdate;
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
  const fireUpdate = useSimulationRefresh(refetch);
  const applyRunUpdate = useRunUpdate(projectId);
  const scheduleUpdate = useDebouncedUpdate(fireUpdate, debounceMs);
  const knownBatchRunIdsRef = useRef<Set<string>>(new Set());

  const subscriptionInput = useMemo(
    () => (tabKey && tabId ? { projectId, tabKey, tabId } : { projectId }),
    [projectId, tabId, tabKey],
  );

  const subscription = useSSESubscription<
    { event: string; timestamp: number },
    { projectId: string; tabKey?: string; tabId?: string }
  >(api.scenarios.onSimulationUpdate, subscriptionInput, {
    enabled: Boolean(enabled && projectId),
    onData: (data) =>
      handleSimulationEvent(data.event, {
        filter,
        tabKey,
        onTabNavigate,
        onStreamingEvent,
        onNewBatchRun,
        knownBatchRunIds: knownBatchRunIdsRef.current,
        scheduleUpdate,
        applyRunUpdate,
      }),
  });

  // Callers use the connection state to disable fallback polling while the
  // event stream is healthy — SSE is the primary freshness signal, polling
  // exists only for disconnected sessions.
  return {
    connectionState: subscription.connectionState,
    isConnected: subscription.isConnected,
  } as const;
}
