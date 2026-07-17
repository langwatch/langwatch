import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
import {
  ORIGIN_RESOLVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
} from "../schemas/constants";
import type { TraceProcessingEvent } from "../schemas/events";

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
/** Pure guard check, shared between the reactor variant below and the
 *  alert-trigger match subscriber (ADR-052) so both stay in sync. Returns
 *  true when the reactor's/subscriber's user-provided body should run. */
export function passesTraceOriginGuards(
  event: TraceProcessingEvent,
  foldState: TraceSummaryData,
): boolean {
  // 1. Skip stale events (replay/resync re-emit old-occurredAt events).
  if (event.occurredAt < Date.now() - OLD_TRACE_THRESHOLD_MS) return false;

  // 2. Only genuine message events re-run side-effecting reactors. A daily
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

/**
 * An extra pure guard, ANDed with the origin guards. Must be synchronous and
 * side-effect free: it runs pre-enqueue via `shouldReact` on the fold's hot
 * path. Guards needing IO belong in `handle`.
 */
type ExtraGuard = (
  event: TraceProcessingEvent,
  context: ReactorContext<TraceSummaryData>,
) => boolean;

export function defineOriginGuardedTraceReactor(opts: {
  name: string;
  jobIdPrefix: string;
  ttl?: number;
  delay?: number;
  isRelevant?: ExtraGuard;
  handle: (
    event: TraceProcessingEvent,
    context: ReactorContext<TraceSummaryData>,
  ) => Promise<void>;
}): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  const passes = (
    event: TraceProcessingEvent,
    context: ReactorContext<TraceSummaryData>,
  ): boolean =>
    passesTraceOriginGuards(event, context.foldState) &&
    (opts.isRelevant?.(event, context) ?? true);

  return {
    name: opts.name,
    options: {
      makeJobId: (payload) =>
        `${opts.jobIdPrefix}:${payload.event.tenantId}:${payload.event.aggregateId}`,
      ttl: opts.ttl ?? 30_000,
      delay: opts.delay ?? 30_000,
    },

    // Pre-enqueue (ADR-026). The guards are pure and read only the payload the
    // handler would receive, so evaluating them here is equivalent to the
    // early-return in `handle` — except a filtered event never pays a
    // serialize + gzip + blob write that the queue's dedup would then discard.
    // A 10k-span trace fans this reactor out once per span; the guards reject
    // nearly all of it. Kept in `handle` too: the queue is not the only caller
    // (inline mode), and a fail-open `shouldReact` may dispatch anyway.
    shouldReact: passes,

    async handle(event, context) {
      if (!passes(event, context)) return;
      await opts.handle(event, context);
    },
  };
}

