import { nowInstant } from "@langwatch/time";

import { SPAN_RECEIVED_EVENT_TYPE } from "./trace-ingress.constants.ts";
import type { TraceSummaryData } from "./trace-projection.ts";
import { ORIGIN_RESOLVED_EVENT_TYPE } from "./trace.constants.ts";

const OLD_TRACE_THRESHOLD_MS = 60 * 60 * 1000;

/**
 * Never re-run an on-message subscriber for a trace whose first span is
 * older than this, even on a genuine new span — bounds the blast radius of
 * any path re-touching historical traces. Distinct from `OLD_TRACE_THRESHOLD_MS`.
 */
const MAX_TRACE_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Trace-processing events that represent genuine new message content and
 * so should (re-)run on-message subscribers. `origin_resolved` is here too,
 * so deferred-origin traces still dispatch once their origin lands.
 */
const MESSAGE_EVENT_TYPES = new Set<string>([SPAN_RECEIVED_EVENT_TYPE, ORIGIN_RESOLVED_EVENT_TYPE]);

/** Pure guard check, shared by trace's origin-guarded subscribers and automation's
 *  trace trigger match (ADR-052) so all stay in sync. Returns true when
 *  the subscriber's user-provided body should run. */
export function passesTraceOriginGuards(
  event: { type: string; occurredAt: number },
  foldState: TraceSummaryData,
): boolean {
  // 1. Skip stale events (replay/resync re-emit old-occurredAt events).
  if (event.occurredAt < nowInstant().epochMilliseconds - OLD_TRACE_THRESHOLD_MS) return false;

  // 2. Only genuine message events re-run side-effecting subscribers. A daily
  //    topic-clustering pass re-emits topic_assigned for thousands of
  //    historical traces; without this it would re-run every monitor/alert
  //    over the whole backlog (2026-05-27 read-amp incident).
  if (!MESSAGE_EVENT_TYPES.has(event.type)) return false;

  // 3. Never re-run for a trace whose first span is older than the cutoff,
  //    even on a genuine new span. Checks the TRACE START
  //    (foldState.occurredAt), not event.occurredAt — a re-emitted or late
  //    event is fresh, but the trace itself is days old.
  if (
    foldState.occurredAt > 0 &&
    foldState.occurredAt < nowInstant().epochMilliseconds - MAX_TRACE_AGE_MS
  ) {
    return false;
  }

  if (foldState.blockedByGuardrail && !foldState.computedOutput) return false;

  const attrs = foldState.attributes ?? {};
  if (!attrs["langwatch.origin"]) return false;

  return true;
}
