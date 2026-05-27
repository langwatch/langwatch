import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "../schemas/events";
import {
  ORIGIN_RESOLVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
} from "../schemas/constants";

const OLD_TRACE_THRESHOLD_MS = 60 * 60 * 1000;

/**
 * Never re-run an on-message reactor for a trace whose first span is older
 * than this, even on a genuine new span. Re-evaluating / re-alerting days-old
 * traces is never wanted, and bounds the blast radius of any path that
 * re-touches historical traces. Distinct from `OLD_TRACE_THRESHOLD_MS` (which
 * skips stale *events*); this bounds the *trace* age.
 */
const MAX_TRACE_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Trace-processing events that represent genuine new message content and so
 * should (re-)run on-message reactors. Everything else (topic assignment,
 * annotations, name changes, log/metric records) updates the fold projection
 * but must NOT fan out to side-effecting reactors. `origin_resolved` is here
 * so deferred-origin traces still dispatch once their origin lands.
 */
const MESSAGE_EVENT_TYPES = new Set<string>([
  SPAN_RECEIVED_EVENT_TYPE,
  ORIGIN_RESOLVED_EVENT_TYPE,
]);

/**
 * Defines a trace-processing reactor that fires only when:
 *   1. the event is recent (<1h old, skips replay/resync floods),
 *   2. the event is a message event (span_received / origin_resolved) — derived
 *      enrichment events like topic_assigned do not re-run side effects,
 *   3. the trace itself is not older than MAX_TRACE_AGE_MS,
 *   4. the trace is not blocked by guardrail with no output, and
 *   5. `langwatch.origin` is resolved on the fold state.
 *
 * The originGate reactor handles deferred resolution for traces that
 * arrive without a resolved origin, so other origin-dependent reactors
 * just no-op until the gate has fired.
 *
 * Wraps the reactor's `handle` with these guards so each call site
 * doesn't repeat the same preamble.
 */
export function defineOriginGuardedTraceReactor(opts: {
  name: string;
  jobIdPrefix: string;
  ttl?: number;
  delay?: number;
  handle: (
    event: TraceProcessingEvent,
    context: ReactorContext<TraceSummaryData>,
  ) => Promise<void>;
}): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return {
    name: opts.name,
    options: {
      makeJobId: (payload) =>
        `${opts.jobIdPrefix}:${payload.event.tenantId}:${payload.event.aggregateId}`,
      ttl: opts.ttl ?? 30_000,
      delay: opts.delay ?? 30_000,
    },

    async handle(event, context) {
      // 1. Skip stale events (replay/resync re-emit old-occurredAt events).
      if (event.occurredAt < Date.now() - OLD_TRACE_THRESHOLD_MS) return;

      // 2. Only genuine message events re-run side-effecting reactors. A daily
      //    topic-clustering pass re-emits topic_assigned for thousands of
      //    historical traces; without this it would re-run every monitor/alert
      //    over the whole backlog (2026-05-27 read-amp incident).
      if (!MESSAGE_EVENT_TYPES.has(event.type)) return;

      const { foldState } = context;

      // 3. Never re-run for a trace whose first span is older than the cutoff,
      //    even on a genuine new span. Checks the TRACE START
      //    (foldState.occurredAt), not event.occurredAt — a re-emitted or late
      //    event is fresh, but the trace itself is days old.
      if (
        foldState.occurredAt > 0 &&
        foldState.occurredAt < Date.now() - MAX_TRACE_AGE_MS
      ) {
        return;
      }

      if (foldState.blockedByGuardrail && !foldState.computedOutput) return;

      const attrs = foldState.attributes ?? {};
      if (!attrs["langwatch.origin"]) return;

      await opts.handle(event, context);
    },
  };
}
