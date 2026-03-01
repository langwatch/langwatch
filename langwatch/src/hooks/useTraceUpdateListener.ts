import { useCallback, useEffect, useRef } from "react";
import { api } from "~/utils/api";
import { usePageVisibility } from "./usePageVisibility";
import { useSSESubscription } from "./useSSESubscription";

interface UseTraceUpdateListenerOptions {
  projectId: string;
  traceId?: string;
  onSpanStored?: (traceIds: string[]) => void | Promise<void>;
  onTraceSummaryUpdated?: (traceIds: string[]) => void | Promise<void>;
  enabled?: boolean;
  pageOffset?: number;
  cursorPageNumber?: number;
  debounceMs?: number;
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
 * Uses trailing-edge debounce: events accumulate traceIds during the window,
 * callback fires only after `debounceMs` of silence. This gives the backend
 * time to finish processing before we fetch.
 *
 * Callbacks receive the accumulated traceIds from the debounce window so
 * callers can decide whether to refetch (visible trace updated) or just
 * bump a counter (new trace not on screen).
 */
export function useTraceUpdateListener({
  projectId,
  traceId,
  onSpanStored,
  onTraceSummaryUpdated,
  enabled = true,
  pageOffset,
  cursorPageNumber,
  debounceMs = 5000,
}: UseTraceUpdateListenerOptions) {
  const isVisible = usePageVisibility();

  // Track when the page became hidden so we can keep processing for a grace period
  const hiddenAtRef = useRef<number>(0);
  const HIDDEN_GRACE_MS = 3 * 60_000; // 3 minutes

  useEffect(() => {
    if (isVisible) {
      hiddenAtRef.current = 0;
    } else if (hiddenAtRef.current === 0) {
      hiddenAtRef.current = Date.now();
    }
  }, [isVisible]);

  const isOnFirstPage =
    (pageOffset === void 0 || pageOffset === 0) &&
    (cursorPageNumber === void 0 || cursorPageNumber <= 1);

  // Evaluated at call time (not memoized) so the grace-period check uses fresh timestamps
  const shouldProcessUpdateNow = useCallback(() => {
    if (!isOnFirstPage) return false;
    if (isVisible) return true;
    // Page is hidden — allow for a grace period
    return (
      hiddenAtRef.current > 0 &&
      Date.now() - hiddenAtRef.current < HIDDEN_GRACE_MS
    );
  }, [isVisible, isOnFirstPage]);

  // Stable refs for callbacks to avoid stale closures in timers
  const onSpanStoredRef = useRef(onSpanStored);
  onSpanStoredRef.current = onSpanStored;

  const onTraceSummaryUpdatedRef = useRef(onTraceSummaryUpdated);
  onTraceSummaryUpdatedRef.current = onTraceSummaryUpdated;

  // Trailing-edge debounce state for span events
  const spanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spanTraceIdsRef = useRef<Set<string>>(new Set());

  // Trailing-edge debounce state for summary events
  const summaryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const summaryTraceIdsRef = useRef<Set<string>>(new Set());

  const scheduleSpanUpdate = useCallback(
    (eventTraceId: string | undefined) => {
      if (!shouldProcessUpdateNow()) return;

      if (eventTraceId) {
        spanTraceIdsRef.current.add(eventTraceId);
      }

      if (spanTimerRef.current) {
        clearTimeout(spanTimerRef.current);
      }
      spanTimerRef.current = setTimeout(() => {
        spanTimerRef.current = null;
        const ids = [...spanTraceIdsRef.current];
        spanTraceIdsRef.current = new Set();
        void onSpanStoredRef.current?.(ids);
      }, debounceMs);
    },
    [shouldProcessUpdateNow, debounceMs],
  );

  const scheduleSummaryUpdate = useCallback(
    (eventTraceId: string | undefined) => {
      if (!shouldProcessUpdateNow()) return;

      if (eventTraceId) {
        summaryTraceIdsRef.current.add(eventTraceId);
      }

      if (summaryTimerRef.current) {
        clearTimeout(summaryTimerRef.current);
      }
      summaryTimerRef.current = setTimeout(() => {
        summaryTimerRef.current = null;
        const ids = [...summaryTraceIdsRef.current];
        summaryTraceIdsRef.current = new Set();
        void onTraceSummaryUpdatedRef.current?.(ids);
      }, debounceMs);
    },
    [shouldProcessUpdateNow, debounceMs],
  );

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (spanTimerRef.current) {
        clearTimeout(spanTimerRef.current);
      }
      if (summaryTimerRef.current) {
        clearTimeout(summaryTimerRef.current);
      }
    };
  }, []);

  useSSESubscription<
    { event: string; timestamp: number },
    { projectId: string }
  >(
    // @ts-expect-error - tRPC subscription type mismatch with useSSESubscription hook
    api.traces.onTraceUpdate,
    { projectId },
    {
      enabled: Boolean(enabled && projectId),
      onData: (data) => {
        if (!shouldProcessUpdateNow()) return;
        if (!data.event) return;

        try {
          const payload: TraceBroadcastPayload =
            typeof data.event === "string"
              ? JSON.parse(data.event)
              : data.event;

          if (traceId && payload.traceId !== traceId) return;

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
}
