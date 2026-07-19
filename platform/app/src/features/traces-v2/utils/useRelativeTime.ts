import { useEffect, useState } from "react";
import { formatRelativeTime, formatVerboseRelative } from "./formatters";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Lower bound on the next-tick interval. A trace whose timestamp is in
 * the future (clock skew) would compute a negative `untilNext`; clamp
 * to one second so the timer still fires and recovers once the wall
 * clock crosses the timestamp.
 */
const MIN_TICK_MS = 1000;

/**
 * Time until the label produced by `formatRelativeTime` /
 * `formatVerboseRelative` next changes, given the trace's timestamp.
 *
 * Boundaries:
 *   - 0..59s ago        → "now" / "just now"        → next change: at the 1-minute mark
 *   - 1..59m ago        → "3m" / "3 minutes ago"    → next change: at the next minute mark
 *   - 1..23h ago        → "5h" / "5 hours ago"      → next change: at the next hour mark
 *   - 1d+ ago           → "Nd" / "N days ago"       → next change: at the next day mark
 *
 * For traces older than a day this naturally schedules infrequent
 * timers (one per day). For traces in the last minute it ticks at the
 * sub-minute boundary instead of every second — a label of "now" never
 * needs to refresh until the trace crosses 60 seconds old.
 */
function msUntilNextLabelChange(timestamp: number): number {
  const diffMs = Math.max(0, Date.now() - timestamp);
  if (diffMs < MS_PER_MINUTE) {
    return Math.max(MIN_TICK_MS, MS_PER_MINUTE - diffMs);
  }
  if (diffMs < MS_PER_HOUR) {
    // 3m label became "3m" at 3*60_000 ms; next change when diff crosses
    // 4*60_000. So wait `4*60_000 - diffMs` from now.
    const minutesElapsed = Math.floor(diffMs / MS_PER_MINUTE);
    const nextBoundary = (minutesElapsed + 1) * MS_PER_MINUTE;
    return Math.max(MIN_TICK_MS, nextBoundary - diffMs);
  }
  if (diffMs < MS_PER_DAY) {
    const hoursElapsed = Math.floor(diffMs / MS_PER_HOUR);
    const nextBoundary = (hoursElapsed + 1) * MS_PER_HOUR;
    return Math.max(MIN_TICK_MS, nextBoundary - diffMs);
  }
  const daysElapsed = Math.floor(diffMs / MS_PER_DAY);
  const nextBoundary = (daysElapsed + 1) * MS_PER_DAY;
  return Math.max(MIN_TICK_MS, nextBoundary - diffMs);
}

/**
 * Compact relative-time label that recomputes itself precisely at the
 * next boundary (the moment "3m" should become "4m", or "5h" should
 * become "6h"). No 1Hz polling — at most one timer per cell, and most
 * cells in a long list reschedule sparsely (older traces tick once an
 * hour, then once a day).
 *
 * Visible label is identical to the static `formatRelativeTime` so the
 * cell layout / width stays unchanged.
 */
export function useRelativeTime(timestamp: number): string {
  const [label, setLabel] = useState(() => formatRelativeTime(timestamp));

  useEffect(() => {
    // Defensive — the timestamp prop changed mid-life of the cell
    // (virtualizer reused the row for a different trace), so blow
    // away any in-flight tick and rebuild from scratch.
    setLabel(formatRelativeTime(timestamp));
    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      const wait = msUntilNextLabelChange(timestamp);
      timerId = setTimeout(() => {
        if (cancelled) return;
        const next = formatRelativeTime(timestamp);
        // Only re-render when the visible label actually moved — avoids
        // tearing through React for boundary calculations that no-op
        // (e.g., clock-skew traces where the diff stays in the same
        // bucket).
        setLabel((prev) => (prev === next ? prev : next));
        schedule();
      }, wait);
    };
    schedule();
    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
    };
  }, [timestamp]);

  return label;
}

/**
 * Verbose-relative variant of {@link useRelativeTime}. Same scheduling
 * contract — "5 minutes ago" only re-renders at the 6-minute mark. Used
 * by the SINCE column and the hover-card header.
 */
export function useVerboseRelativeTime(timestamp: number): string {
  const [label, setLabel] = useState(() => formatVerboseRelative(timestamp));

  useEffect(() => {
    setLabel(formatVerboseRelative(timestamp));
    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      const wait = msUntilNextLabelChange(timestamp);
      timerId = setTimeout(() => {
        if (cancelled) return;
        const next = formatVerboseRelative(timestamp);
        setLabel((prev) => (prev === next ? prev : next));
        schedule();
      }, wait);
    };
    schedule();
    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
    };
  }, [timestamp]);

  return label;
}
