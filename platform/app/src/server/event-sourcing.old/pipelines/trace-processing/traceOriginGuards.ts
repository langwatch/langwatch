import type { TraceSummaryData } from "./projections/traceSummary.foldProjection";
import {
  ORIGIN_RESOLVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
  STALE_TRACE_THRESHOLD_MS,
} from "./schemas/constants";
import type { TraceProcessingEvent } from "./schemas/events";

/**
 * Never re-run on-message work for a trace whose first span is older than
 * this, even on a genuine new span. Re-evaluating / re-alerting days-old
 * traces is never wanted, and it bounds the blast radius of any path that
 * re-touches historical traces. Distinct from `STALE_TRACE_THRESHOLD_MS`
 * (which skips stale *events*); this bounds the *trace* age.
 */
const MAX_TRACE_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Trace-processing events that represent genuine new message content and so
 * should (re-)run on-message work. Everything else (topic assignment,
 * annotations, name changes, log/metric records) updates the fold projection
 * but must NOT fan out to side effects. `origin_resolved` is here so
 * deferred-origin traces still dispatch once their origin lands.
 */
const MESSAGE_EVENT_TYPES = new Set<string>([
  SPAN_RECEIVED_EVENT_TYPE,
  ORIGIN_RESOLVED_EVENT_TYPE,
]);

/**
 * Whether on-message work should run for this event against this trace.
 *
 * Pure and synchronous, so it is safe anywhere — including a subscriber's
 * pre-enqueue filter. Single-sourced here so the trace-processing consumers
 * and the enterprise alert-trigger subscriber cannot drift apart.
 */
export function passesTraceOriginGuards(
  event: TraceProcessingEvent,
  foldState: TraceSummaryData,
): boolean {
  // 1. Skip stale events (replay/resync re-emit old-occurredAt events).
  if (event.occurredAt < Date.now() - STALE_TRACE_THRESHOLD_MS) return false;

  // 2. Only genuine message events re-run side effects. A daily
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
    foldState.occurredAt < Date.now() - MAX_TRACE_AGE_MS
  ) {
    return false;
  }

  if (foldState.blockedByGuardrail && !foldState.computedOutput) return false;

  const attrs = foldState.attributes ?? {};
  if (!attrs["langwatch.origin"]) return false;

  return true;
}
