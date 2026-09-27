import { nowInstant } from "@langwatch/time";
import { useSSESubscription } from "@langwatch/trace-browser-kit";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../behavior/trace-api.ts";

interface UseTraceUpdateListenerOptions {
  projectId: string;
  traceId?: string;
  onSpanStored?: (traceIds: string[]) => void | Promise<void>;
  onTraceSummaryUpdated?: (traceIds: string[]) => void | Promise<void>;
  enabled?: boolean;
  debounceMs?: number;
  /**
   * Maximum time (ms) between callback fires during continuous events. Without this,
   * trailing-edge debounce never fires during active ingestion because each event
   * resets the timer.
   */
  maxWaitMs?: number;
}

interface TraceBroadcastPayload {
  event: string;
  traceId?: string;
}

type Timer = ReturnType<typeof setTimeout>;

/**
 * Trace ids batched behind a trailing debounce, with an optional max wait so a
 * steady stream of events still flushes; each event would otherwise reset the timer.
 */
function useBatchedTraceIds({
  onFlush,
  debounceMs,
  maxWaitMs,
}: {
  onFlush: ((traceIds: string[]) => void | Promise<void>) | undefined;
  debounceMs: number;
  maxWaitMs: number | undefined;
}) {
  // The latest callback, read when a timer fires rather than when it was set.
  const onFlushRef = useRef(onFlush);
  onFlushRef.current = onFlush;
  const debounceRef = useRef<Timer | null>(null);
  const maxWaitRef = useRef<Timer | null>(null);
  const idsRef = useRef<Set<string>>(new Set());

  const clearTimers = useCallback(() => {
    for (const timer of [debounceRef, maxWaitRef]) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const flush = useCallback(() => {
    clearTimers();
    const ids = [...idsRef.current];
    idsRef.current = new Set();
    if (ids.length > 0) void onFlushRef.current?.(ids);
  }, [clearTimers]);

  const schedule = useCallback(
    (eventTraceId: string | undefined) => {
      if (eventTraceId) idsRef.current.add(eventTraceId);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(flush, debounceMs);
      if (maxWaitMs != null && !maxWaitRef.current) {
        maxWaitRef.current = setTimeout(flush, maxWaitMs);
      }
    },
    [debounceMs, maxWaitMs, flush],
  );

  useEffect(() => clearTimers, [clearTimers]);
  return schedule;
}

/** The broadcast an SSE event carries; a non-JSON payload carries none. */
function broadcastsIn(event: unknown): TraceBroadcastPayload[] {
  try {
    const parsed: TraceBroadcastPayload | null =
      typeof event === "string" ? JSON.parse(event) : event;
    return parsed && typeof parsed === "object" ? [parsed] : [];
  } catch {
    return [];
  }
}

/**
 * Hook for subscribing to real-time trace updates via tRPC subscriptions.
 * Differentiates between span storage events and trace summary updates so callers can
 * refetch only the relevant data.
 */
export function useTraceUpdateListener({
  projectId,
  traceId,
  onSpanStored,
  onTraceSummaryUpdated,
  enabled = true,
  debounceMs = 5000,
  maxWaitMs,
}: UseTraceUpdateListenerOptions) {
  const scheduleSpanUpdate = useBatchedTraceIds({ onFlush: onSpanStored, debounceMs, maxWaitMs });
  const scheduleSummaryUpdate = useBatchedTraceIds({
    onFlush: onTraceSummaryUpdated,
    debounceMs,
    maxWaitMs,
  });
  const scheduleByEvent: Record<string, (traceId: string | undefined) => void> = {
    span_stored: scheduleSpanUpdate,
    trace_summary_updated: scheduleSummaryUpdate,
  };

  const [lastEventAt, setLastEventAt] = useState<number>(0);

  const sse = useSSESubscription<{ event: string; timestamp: number }, { projectId: string }>(
    // @ts-expect-error - tRPC subscription type mismatch with useSSESubscription hook
    api.traces.onTraceUpdate,
    { projectId },
    {
      enabled: Boolean(enabled && projectId),
      onData: (data) => {
        if (!data.event) return;
        for (const payload of broadcastsIn(data.event)) {
          if (traceId && payload.traceId !== traceId) continue;
          setLastEventAt(nowInstant().epochMilliseconds);
          scheduleByEvent[payload.event]?.(payload.traceId);
        }
      },
    },
  );

  return {
    connectionState: sse.connectionState,
    lastEventAt,
  };
}
