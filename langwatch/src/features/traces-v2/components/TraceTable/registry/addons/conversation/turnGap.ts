import type { TraceListItem } from "../../../../../types/trace";

const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;

export const TURN_GAP_VISIBLE_SECONDS = 2;
export const TURN_GAP_PAUSE_SECONDS = 30;

export function turnGapSeconds({
  trace,
  prevTrace,
}: {
  trace: TraceListItem;
  prevTrace: TraceListItem | undefined;
}): number {
  if (!prevTrace) return 0;
  return (trace.timestamp - (prevTrace.timestamp + prevTrace.durationMs)) /
    MS_PER_SECOND;
}

export function formatGapSeconds(seconds: number): string {
  if (seconds >= SECONDS_PER_MINUTE) {
    const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
    const remaining = Math.floor(seconds % SECONDS_PER_MINUTE);
    return `${minutes}m ${remaining}s`;
  }
  return `${seconds.toFixed(1)}s`;
}
