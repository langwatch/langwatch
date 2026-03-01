import { useCallback, useEffect, useMemo, useRef } from "react";
import { api } from "~/utils/api";
import { usePageVisibility } from "./usePageVisibility";
import { useSSESubscription } from "./useSSESubscription";

interface UseTraceUpdateListenerOptions {
  projectId: string;
  traceId?: string;
  refetch?: () => void | Promise<void>;
  enabled?: boolean;
  debounceMs?: number;
  pageOffset?: number;
  cursorPageNumber?: number;
}

/**
 * Hook for subscribing to real-time trace updates via tRPC subscriptions.
 * Automatically connects to SSE when enabled and calls refetch when traces are updated.
 * Includes optimizations to reduce unnecessary updates based on page visibility and pagination.
 *
 * @param options - Configuration options
 * @param options.projectId - The project/tenant ID to subscribe to
 * @param options.traceId - Optional trace ID to filter events to a specific trace
 * @param options.refetch - Function to call when traces are updated (usually a query refetch function)
 * @param options.enabled - Whether the subscription should be active (default: true)
 * @param options.debounceMs - Debounce delay in milliseconds (default: 1000)
 * @param options.pageOffset - Current page offset for offset-based pagination
 * @param options.cursorPageNumber - Current page number for cursor-based pagination
 */
export function useTraceUpdateListener({
  projectId,
  traceId,
  refetch,
  enabled = true,
  debounceMs = 1000,
  pageOffset,
  cursorPageNumber,
}: UseTraceUpdateListenerOptions) {
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isVisible = usePageVisibility();

  // Check if we should process updates based on optimization conditions
  const shouldProcessUpdate = useMemo(() => {
    // Don't process if tab is not visible
    if (!isVisible) return false;

    // only update if on first page
    if (pageOffset !== void 0 && pageOffset > 0) return false;
    // only update if on first page
    if (cursorPageNumber !== void 0 && cursorPageNumber > 1) return false;

    return true;
  }, [isVisible, pageOffset, cursorPageNumber]);

  // Debounced update handler
  const debouncedUpdate = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    debounceTimerRef.current = setTimeout(() => {
      if (shouldProcessUpdate && refetch) {
        void refetch();
      }
    }, debounceMs);
  }, [shouldProcessUpdate, debounceMs, refetch]);

  // Cleanup debounce timer on unmount
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
    // @ts-expect-error - tRPC subscription type mismatch with useSSESubscription hook
    api.traces.onTraceUpdate,
    { projectId },
    {
      enabled: Boolean(enabled && projectId),
      onData: (data) => {
        if (data.event) {
          try {
            const payload =
              typeof data.event === "string" ? JSON.parse(data.event) : data.event;

            if (payload.event === "trace_updated") {
              if (traceId && payload.traceId !== traceId) return;
              debouncedUpdate();
            }
          } catch {
            // If payload isn't JSON, treat as a generic trace update
            if (data.event === "trace_updated") {
              debouncedUpdate();
            }
          }
        }
      },
    },
  );
}
