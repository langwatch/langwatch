import type {
  SubscriberSpec,
  TriggerContext,
} from "../../../pipeline/processManagerDefinition";
import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
import {
  ORIGIN_RESOLVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
} from "../schemas/constants";
import type { TraceProcessingEvent } from "../schemas/events";
// Single-sourced with the reactor variant: `passesTraceOriginGuards` lives in
// `_originGuardedReactor.ts` and is imported here so both the reactor and the
// subscriber (and the EE trace-alert subscriber) share one copy of the
// replay/loop-prevention guard — a future fix can never miss a stale duplicate.
import { passesTraceOriginGuards } from "./_originGuardedReactor";

const OLD_TRACE_THRESHOLD_MS = 60 * 60 * 1000;

/**
 * A named subscriber spec on the traceSummary fold, ready for
 * `.withSubscriber(x.name, x.spec)` on the trace-processing pipeline
 * (ADR-052). `ctx.state` is the committed traceSummary fold state.
 */
export type TraceSummarySubscriber = {
  name: string;
  spec: SubscriberSpec<TraceProcessingEvent> & {
    handler: (
      event: TraceProcessingEvent,
      context: TriggerContext<TraceSummaryData>,
    ) => Promise<void>;
  };
};

/**
 * An extra pure, EVENT-ONLY guard, ANDed with the origin guards. Must be
 * synchronous and side-effect free: it runs pre-enqueue via `when` on the
 * fold's hot path. Guards needing fold state or IO belong in the handler.
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
 * The event-only guards (stale event, message event types via the spec's
 * `events` filter, `isRelevant`) reject pre-enqueue via `when`/`events`; the
 * fold-state-dependent guards run at the top of the handler against the
 * committed `ctx.state` (which re-checks the event-only guards too, so the
 * handler stays safe for any caller).
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
  return {
    name: opts.name,
    spec: {
      fold: "traceSummary",
      // Guard 2, expressed as the spec's event-type filter: only genuine
      // message events fan out to side-effecting subscribers.
      events: [SPAN_RECEIVED_EVENT_TYPE, ORIGIN_RESOLVED_EVENT_TYPE],
      // Pre-enqueue (ADR-026): the event-only guards are pure and reject
      // before the queue pays serialize + gzip + blob write. A 10k-span
      // trace fans this subscriber out once per span; these reject nearly
      // all of it.
      when: (event) =>
        event.occurredAt >= Date.now() - OLD_TRACE_THRESHOLD_MS &&
        (opts.isRelevant?.(event) ?? true),
      ttl: opts.ttl ?? 30_000,
      delay: opts.delay ?? 30_000,
      handler: async (event, context) => {
        // Full guard chain against the committed fold state — `when` can only
        // see the event, so the fold-state-dependent guards live here (and the
        // event-only ones are re-checked, keeping the handler fail-safe).
        if (!passesTraceOriginGuards(event, context.state)) return;
        if (opts.isRelevant && !opts.isRelevant(event)) return;
        await opts.handler(event, context);
      },
    },
  };
}
