import type { SubscriberSpec, TriggerContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
import {
  ORIGIN_RESOLVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
} from "../schemas/constants";
import type { TraceProcessingEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:trace-processing:origin-guarded-subscriber",
);

const OLD_TRACE_THRESHOLD_MS = 60 * 60 * 1000;

/**
 * Never re-run an on-message subscriber for a trace whose first span is older
 * than this, even on a genuine new span. Re-evaluating / re-alerting days-old
 * traces is never wanted, and bounds the blast radius of any path that
 * re-touches historical traces. Distinct from `OLD_TRACE_THRESHOLD_MS` (which
 * skips stale *events*); this bounds the *trace* age.
 */
const MAX_TRACE_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Trace-processing events that represent genuine new message content and so
 * should (re-)run on-message subscribers. Everything else (topic assignment,
 * annotations, name changes, log/metric records) updates the fold projection
 * but must NOT fan out to side-effecting subscribers. `origin_resolved` is
 * here so deferred-origin traces still dispatch once their origin lands.
 */
const MESSAGE_EVENT_TYPES = new Set<string>([
  SPAN_RECEIVED_EVENT_TYPE,
  ORIGIN_RESOLVED_EVENT_TYPE,
]);

/** Pure guard check, shared by the origin-guarded subscribers below and the
 *  EE trace-alert subscriber (ADR-052) so all stay in sync. Returns true when
 *  the subscriber's user-provided body should run. */
export function passesTraceOriginGuards(
  event: TraceProcessingEvent,
  foldState: TraceSummaryData,
): boolean {
  // 1. Skip stale events (replay/resync re-emit old-occurredAt events).
  if (event.occurredAt < Date.now() - OLD_TRACE_THRESHOLD_MS) return false;

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
 * A named subscriber spec on the traceSummary fold, ready for
 * `.withProjectionSubscriber(x.name, x.spec)` on the trace-processing pipeline
 * (ADR-052). `ctx.state` is the committed traceSummary fold state.
 */
export type TraceSummarySubscriber = {
  name: string;
  spec: SubscriberSpec<TraceProcessingEvent> & {
    fold: "traceSummary";
    handler: (
      event: TraceProcessingEvent,
      context: TriggerContext<TraceSummaryData>,
    ) => Promise<void>;
  };
};

/**
 * An extra pure, EVENT-ONLY guard, ANDed with the origin guards. Must be
 * synchronous and side-effect free: it runs pre-enqueue via `when` on the
 * fold's hot path. Guards needing IO belong in the handler.
 */
type ExtraGuard = (event: TraceProcessingEvent) => boolean;

/**
 * Defines a trace-processing subscriber on the traceSummary fold that fires
 * only when:
 *   1. the event is recent (<1h old, skips replay/resync floods),
 *   2. the event is a message event (span_received / origin_resolved) — derived
 *      enrichment events like topic_assigned do not re-run side effects,
 *   3. the trace itself is not older than MAX_TRACE_AGE_MS,
 *   4. the trace is not blocked by guardrail with no output, and
 *   5. `langwatch.origin` is resolved on the fold state.
 *
 * The originGate subscriber handles deferred resolution for traces that
 * arrive without a resolved origin, so other origin-dependent subscribers
 * just no-op until the gate has fired.
 *
 * The full guard chain — fold-state guards included — rejects pre-enqueue via
 * `when`, which receives the committed fold state: a filtered event
 * never pays a serialize + gzip + blob write that the queue's dedup would then
 * discard. A 10k-span trace fans a subscriber out once per span; the guards
 * reject nearly all of it. The handler re-checks, staying safe for any caller
 * and for a fail-open `when`.
 */
export function defineOriginGuardedTraceSubscriber(opts: {
  name: string;
  ttl?: number;
  delay?: number;
  isRelevant?: ExtraGuard;
  handler: (
    event: TraceProcessingEvent,
    context: TriggerContext<TraceSummaryData>,
  ) => Promise<void>;
}): TraceSummarySubscriber {
  const passes = (
    event: TraceProcessingEvent,
    context: TriggerContext<TraceSummaryData>,
  ): boolean =>
    passesTraceOriginGuards(event, context.state) &&
    (opts.isRelevant?.(event) ?? true);

  return {
    name: opts.name,
    spec: {
      fold: "traceSummary",
      // Guard 2, expressed as the spec's event-type filter too, so the
      // cheap Set lookup runs before the guard chain.
      events: [SPAN_RECEIVED_EVENT_TYPE, ORIGIN_RESOLVED_EVENT_TYPE],
      when: passes,
      ttl: opts.ttl ?? 30_000,
      delay: opts.delay ?? 30_000,
      handler: async (event, context) => {
        // Fails open exactly like the router does for `when` (ADR-026): a
        // throwing guard costs one log line and one redundant run, never a
        // dropped side effect. Without this the re-check that exists to make
        // a fail-open `when` safe would itself be the thing that loses the
        // work it was added to protect.
        let relevant = true;
        try {
          relevant = passes(event, context);
        } catch (error) {
          logger.error(
            { subscriberName: opts.name, eventId: event.id, error },
            "Origin guard threw during handler revalidation — failing open and running the subscriber",
          );
        }
        if (!relevant) return;
        await opts.handler(event, context);
      },
    },
  };
}
