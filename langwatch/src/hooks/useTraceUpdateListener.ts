import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "~/utils/api";
import type { ConnectionState } from "./useSSESubscription";
import { useSSESubscription } from "./useSSESubscription";

interface UseTraceUpdateListenerOptions {
  projectId: string;
  traceId?: string;
  onSpanStored?: (traceIds: string[]) => void | Promise<void>;
  onTraceSummaryUpdated?: (traceIds: string[]) => void | Promise<void>;
  enabled?: boolean;
  debounceMs?: number;
  /**
   * Maximum time (ms) between callback fires during continuous events.
   * Without this, trailing-edge debounce never fires during active ingestion
   * because each event resets the timer.
   *
   * When set, the first event starts a maxWait timer that fires regardless
   * of whether new events keep arriving. After firing, the cycle resets.
   * If omitted, pure trailing-edge debounce is used (existing behavior).
   */
  maxWaitMs?: number;
}

interface TraceBroadcastPayload {
  event: string;
  traceId?: string;
}

/**
 * Hook for subscribing to real-time trace updates via tRPC subscriptions.
 * Differentiates between span storage events and trace summary updates
 * so callers can refetch only the relevant data.
 *
 * Supports two modes:
 * - **Trailing-edge debounce** (default): events accumulate traceIds during the
 *   window, callback fires only after `debounceMs` of silence.
 * - **Throttle with maxWait**: callback fires at most every `maxWaitMs` during
 *   continuous events, ensuring updates are visible during active ingestion.
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
  // Stable refs for callbacks to avoid stale closures in timers
  const onSpanStoredRef = useRef(onSpanStored);
  onSpanStoredRef.current = onSpanStored;

  const onTraceSummaryUpdatedRef = useRef(onTraceSummaryUpdated);
  onTraceSummaryUpdatedRef.current = onTraceSummaryUpdated;

  // Debounce/throttle state for span events
  const spanDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spanMaxWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spanTraceIdsRef = useRef<Set<string>>(new Set());

  // Debounce/throttle state for summary events
  const summaryDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const summaryMaxWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const summaryTraceIdsRef = useRef<Set<string>>(new Set());

  const flushSpanUpdate = useCallback(() => {
    if (spanDebounceTimerRef.current) {
      clearTimeout(spanDebounceTimerRef.current);
      spanDebounceTimerRef.current = null;
    }
    if (spanMaxWaitTimerRef.current) {
      clearTimeout(spanMaxWaitTimerRef.current);
      spanMaxWaitTimerRef.current = null;
    }
    const ids = [...spanTraceIdsRef.current];
    spanTraceIdsRef.current = new Set();
    if (ids.length > 0) {
      void onSpanStoredRef.current?.(ids);
    }
  }, []);

  const flushSummaryUpdate = useCallback(() => {
    if (summaryDebounceTimerRef.current) {
      clearTimeout(summaryDebounceTimerRef.current);
      summaryDebounceTimerRef.current = null;
    }
    if (summaryMaxWaitTimerRef.current) {
      clearTimeout(summaryMaxWaitTimerRef.current);
      summaryMaxWaitTimerRef.current = null;
    }
    const ids = [...summaryTraceIdsRef.current];
    summaryTraceIdsRef.current = new Set();
    if (ids.length > 0) {
      void onTraceSummaryUpdatedRef.current?.(ids);
    }
  }, []);

  const scheduleSpanUpdate = useCallback(
    (eventTraceId: string | undefined) => {
      if (eventTraceId) {
        spanTraceIdsRef.current.add(eventTraceId);
      }

      // Reset trailing-edge debounce timer
      if (spanDebounceTimerRef.current) {
        clearTimeout(spanDebounceTimerRef.current);
      }
      spanDebounceTimerRef.current = setTimeout(flushSpanUpdate, debounceMs);

      // Start maxWait timer on first event in this cycle (if maxWaitMs is set)
      if (maxWaitMs != null && !spanMaxWaitTimerRef.current) {
        spanMaxWaitTimerRef.current = setTimeout(flushSpanUpdate, maxWaitMs);
      }
    },
    [debounceMs, maxWaitMs, flushSpanUpdate],
  );

  const scheduleSummaryUpdate = useCallback(
    (eventTraceId: string | undefined) => {
      if (eventTraceId) {
        summaryTraceIdsRef.current.add(eventTraceId);
      }

      // Reset trailing-edge debounce timer
      if (summaryDebounceTimerRef.current) {
        clearTimeout(summaryDebounceTimerRef.current);
      }
      summaryDebounceTimerRef.current = setTimeout(flushSummaryUpdate, debounceMs);

      // Start maxWait timer on first event in this cycle (if maxWaitMs is set)
      if (maxWaitMs != null && !summaryMaxWaitTimerRef.current) {
        summaryMaxWaitTimerRef.current = setTimeout(flushSummaryUpdate, maxWaitMs);
      }
    },
    [debounceMs, maxWaitMs, flushSummaryUpdate],
  );

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (spanDebounceTimerRef.current) clearTimeout(spanDebounceTimerRef.current);
      if (spanMaxWaitTimerRef.current) clearTimeout(spanMaxWaitTimerRef.current);
      if (summaryDebounceTimerRef.current) clearTimeout(summaryDebounceTimerRef.current);
      if (summaryMaxWaitTimerRef.current) clearTimeout(summaryMaxWaitTimerRef.current);
    };
  }, []);

  const [lastEventAt, setLastEventAt] = useState<number>(0);

  const sse = useSSESubscription<
    { event: string; timestamp: number },
    { projectId: string }
  >(
    // @ts-expect-error - tRPC subscription type mismatch with useSSESubscription hook
    api.traces.onTraceUpdate,
    { projectId },
    {
      enabled: Boolean(enabled && projectId),
      onData: (data) => {
        if (!data.event) return;

        try {
          const payload: TraceBroadcastPayload =
            typeof data.event === "string"
              ? JSON.parse(data.event)
              : data.event;

          if (traceId && payload.traceId !== traceId) return;

          setLastEventAt(Date.now());

          if (payload.event === "span_stored") {
            scheduleSpanUpdate(payload.traceId);
          } else if (payload.event === "trace_summary_updated") {
            scheduleSummaryUpdate(payload.traceId);
          }
        } catch {
          // Non-JSON payload — ignore
        }
      },
    },
  );

  return {
    connectionState: sse.connectionState,
    lastEventAt,
  };
}
