import type { NormalizedSpan } from "../../trace.spans.ts";
import type { TraceSummaryData } from "../ingest/trace-projection.ts";
import { isStorableSpanTimeMs } from "./span-storability.ts";
import type { LogTraceContribution } from "./trace-log-contribution.ts";

const SYNTHETIC_SPAN_NAMES: ReadonlySet<string> = new Set(["langwatch.track_event"]);

/**
 * Accumulates trace-level timing from individual spans: the earliest
 * `occurredAt` and the total wall-clock duration covering all spans seen
 * so far.
 */
export function accumulateSpanTiming({
  state,
  span,
}: {
  state: TraceSummaryData;
  span: NormalizedSpan;
}): {
  occurredAt: number;
  totalDurationMs: number;
} {
  const hasMeasurableWindow =
    !SYNTHETIC_SPAN_NAMES.has(span.name) &&
    isStorableSpanTimeMs(span.startTimeUnixMs) &&
    isStorableSpanTimeMs(span.endTimeUnixMs);
  if (!hasMeasurableWindow) {
    return {
      occurredAt: state.occurredAt,
      totalDurationMs: state.totalDurationMs,
    };
  }

  return mergeTimeWindow({ state, startMs: span.startTimeUnixMs, endMs: span.endTimeUnixMs });
}

/** How far a log record's own time may sit from its accept time before it is a broken clock. */
const LOG_TIME_MAX_SKEW_MS = 24 * 60 * 60 * 1000;

/**
 * A Grok trace's window from its first log record to its last (ADR-192); Grok sends no spans.
 * Claude and Codex records can join a span-timed trace through a valid wire trace id, so they,
 * like wire-correlated logs, leave the window to spans.
 */
export function accumulateLogTiming({
  state,
  correlationSource,
  timeUnixMs,
  acceptedAtMs,
}: {
  state: Pick<TraceSummaryData, "occurredAt" | "totalDurationMs">;
  correlationSource: LogTraceContribution["correlationSource"];
  timeUnixMs: number;
  acceptedAtMs: number;
}): {
  occurredAt: number;
  totalDurationMs: number;
} {
  // The window also anchors storage (ADR-071), so a clock far off the accept time never sets it.
  const plausible =
    isStorableSpanTimeMs(timeUnixMs) && Math.abs(acceptedAtMs - timeUnixMs) <= LOG_TIME_MAX_SKEW_MS;
  if (correlationSource !== "grok_synthesized" || !plausible) {
    return { occurredAt: state.occurredAt, totalDurationMs: state.totalDurationMs };
  }

  return mergeTimeWindow({ state, startMs: timeUnixMs, endMs: timeUnixMs });
}

/** Widens the trace window (an `occurredAt` of 0 means none yet) to cover `startMs`..`endMs`. */
function mergeTimeWindow({
  state,
  startMs,
  endMs,
}: {
  state: Pick<TraceSummaryData, "occurredAt" | "totalDurationMs">;
  startMs: number;
  endMs: number;
}): { occurredAt: number; totalDurationMs: number } {
  const occurredAt = state.occurredAt > 0 ? Math.min(state.occurredAt, startMs) : startMs;
  const currentEnd = state.occurredAt > 0 ? state.occurredAt + state.totalDurationMs : 0;
  // Never negative: a customer clock that ran backwards mid-span sends an end before its
  // start, and a negative trace duration is neither renderable nor aggregatable.
  const totalDurationMs = Math.max(0, Math.max(currentEnd, endMs) - occurredAt);

  return { occurredAt, totalDurationMs };
}
