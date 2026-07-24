import { useEffect, useRef, useState } from "react";

/**
 * Minimum time the switch overlay stays up once the new trace's data has
 * resolved. Sibling/hover prefetch makes most switches resolve instantly,
 * so without a floor the overlay would never paint and the content would
 * just pop — the exact thing this exists to fix. 240ms is long enough to
 * register as a deliberate refresh without feeling sluggish.
 */
const MIN_OVERLAY_MS = 240;

/**
 * Drives the brief "refreshing" overlay the trace drawer shows when it
 * switches to a *different* trace. Returns whether the overlay should be
 * visible right now.
 *
 * Deliberately scoped to genuine A→B switches:
 *   - a same-trace data refresh (live update, manual refetch) leaves
 *     `traceId` unchanged, so the overlay never fires — the user keeps
 *     looking at the trace they're on without a full-surface flash;
 *   - the first open has no previous trace, so it falls through to the
 *     drawer's own skeleton rather than this overlay.
 *
 * The overlay holds until the new trace's data has loaded AND a short
 * minimum has elapsed, so even an instant (prefetched) switch flashes the
 * overlay instead of popping straight to the new content.
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
