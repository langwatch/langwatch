import type { SubscriberSpec, TriggerContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { TraceSummaryData, TraceProcessingEvent } from "@langwatch/trace-contract";
import {
  ORIGIN_RESOLVED_EVENT_TYPE,
  passesTraceOriginGuards,
  SPAN_RECEIVED_EVENT_TYPE,
} from "@langwatch/trace-contract";

const logger = createLogger("langwatch:trace-processing:origin-guarded-subscriber");

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
