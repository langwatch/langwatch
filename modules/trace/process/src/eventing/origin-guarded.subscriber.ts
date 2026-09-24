import type { SubscriberSpec, TriggerContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import type { TraceSummaryData, TraceProcessingEvent } from "@langwatch/trace-contract";
import { ORIGIN_RESOLVED_EVENT_TYPE, SPAN_RECEIVED_EVENT_TYPE } from "@langwatch/trace-contract";

const logger = createLogger("langwatch:trace-processing:origin-guarded-subscriber");

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

/** Pure guard check, shared by the origin-guarded subscribers below and the
 *  EE trace-alert subscriber (ADR-052) so all stay in sync. Returns true when
 *  the subscriber's user-provided body should run. */
export function passesTraceOriginGuards(
  event: TraceProcessingEvent,
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

/**
 * A named subscriber spec on the traceSummary fold, ready for
 * `.withProjectionSubscriber(x.name, x.spec)` on the trace-processing pipeline
 * (ADR-052). `ctx.state` is the committed traceSummary fold state.
 */
export type TraceSummarySubscriber = {
  name: string;
  spec: SubscriberSpec<TraceProcessingEvent, TraceSummaryData> & { fold: "traceSummary" };
};

/**
 * An extra pure, EVENT-ONLY guard, ANDed with the origin guards. Must be
 * synchronous and side-effect free: it runs pre-enqueue via `when` on the
 * fold's hot path. Guards needing IO belong in the handler.
 */
type ExtraGuard = (event: TraceProcessingEvent) => boolean;

// Guards pre-enqueue to prevent serialization waste on fold fan-outs;
// handler re-checks for fail-open safety.
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
  ): boolean => passesTraceOriginGuards(event, context.state) && (opts.isRelevant?.(event) ?? true);

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
