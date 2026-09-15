import { useEffect, useRef, useState } from "react";

/**
 * Minimum time the switch overlay stays up once the new trace's data has resolved.
 */
const MIN_OVERLAY_MS = 240;

/**
 * Drives the brief "refreshing" overlay the trace drawer shows when it switches to a
 * *different* trace. Returns whether the overlay should be visible right now.
 */
export function useTraceSwitchOverlay({
  traceId,
  isLoading,
}: {
  traceId: string | undefined;
  isLoading: boolean;
}): boolean {
  const [isVisible, setIsVisible] = useState(false);
  const previousTraceId = useRef(traceId);

  useEffect(() => {
    const previous = previousTraceId.current;
    previousTraceId.current = traceId;
    // Only a switch between two different, non-empty traces triggers the
    // overlay — not the first open (previous undefined) and not a
    // same-trace refresh (previous === traceId).
    if (traceId && previous && traceId !== previous) {
      setIsVisible(true);
    }
  }, [traceId]);

  useEffect(() => {
    if (!isVisible) return;
    // Hold the overlay while the newly-selected trace is still loading…
    if (isLoading) return;
    // …then keep it up for a short floor so fast/prefetched switches still
    // read as a visible refresh rather than an instant pop.
    const timer = setTimeout(() => setIsVisible(false), MIN_OVERLAY_MS);
    return () => clearTimeout(timer);
  }, [isVisible, isLoading, traceId]);

  return isVisible;
}
