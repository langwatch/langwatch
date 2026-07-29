import { createLogger } from "@langwatch/observability";
import type { BroadcastService } from "../../../../app-layer/broadcast/broadcast.service";
import type {
  EventSubscriberContext,
  EventSubscriberDefinition,
} from "../../../subscribers/eventSubscriber.types";
import { TRACE_PROCESSING_EVENT_TYPES } from "../schemas/constants";
import type { TraceProcessingEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:trace-processing:trace-update-broadcast-subscriber",
);

/**
 * Debounce window for the SSE nudge. Not a durability window: it collapses a
 * burst of events on one trace into a single push, and the frontend debounces
 * duplicates on its own side too.
 */
export const TRACE_UPDATE_BROADCAST_DEDUP_TTL_MS = 30_000;

export interface TraceUpdateBroadcastSubscriberDeps {
  broadcast: BroadcastService;
  /**
   * Without Redis the worker-to-web pub/sub bridge does not exist, so a push
   * emitted here could never reach a browser. `false` disables the subscriber
   * outright rather than emitting into nothing.
   */
  hasRedis?: boolean;
}

/**
 * Pushes a "this trace changed, refetch it" nudge to whichever SSE clients are
 * connected right now (ADR-075 Class A).
 *
 * **At-most-once, by design — do not make this durable.** A push is only
 * meaningful to a browser that is connected at the moment it is sent. There is
 * deliberately no outbox, no retry and no redelivery: an outbox replaying this
 * push to a tab that closed an hour ago is a leak, not a fix. A lost push costs
 * nothing, because the client refetches on its next interaction and the next
 * event on the trace pushes again. That is why a broadcast failure is logged
 * and swallowed rather than thrown — throwing would hand the job back to the
 * queue for redelivery, which is the durability this deliberately does not
 * want.
 *
 * Fires on every trace-processing event type, matching what the `traceSummary`
 * fold folds. The event carries everything the push needs (tenant + trace id),
 * so no projection state is read — subscribers have none.
 *
 * Ordering note: as a reactor this ran after the `traceSummary` fold committed;
 * as a subscriber it is dispatched from the routing seam, independent of the
 * fold. The nudge therefore says "something happened on this trace", not "the
 * summary for this trace is already stored". No reader can tell: the payload
 * carries `{ event, traceId }` and nothing else, and `useTraceUpdateListener`
 * only uses the trace id to decide *whether* to refetch — every consumer then
 * reads the store fresh (`MessagesList`/`MessagesTable` → `traceGroups.refetch()`,
 * `useTraceFreshness` → tRPC `invalidate`, `SpanTree` → `loader.onSpanStored()`).
 */
export function createTraceUpdateBroadcastSubscriber(
  deps: TraceUpdateBroadcastSubscriberDeps,
): EventSubscriberDefinition<TraceProcessingEvent> {
  return {
    name: "traceUpdateBroadcast",
    eventTypes: TRACE_PROCESSING_EVENT_TYPES,
    options: {
      disabled: deps.hasRedis === false,
      deduplication: {
        makeId: (event) =>
          `trace-update:${event.tenantId}:${String(event.aggregateId)}`,
        ttlMs: TRACE_UPDATE_BROADCAST_DEDUP_TTL_MS,
      },
    },

    async handle(
      _event: TraceProcessingEvent,
      context: EventSubscriberContext,
    ): Promise<void> {
      const { tenantId, aggregateId: traceId } = context;

      try {
        const payload = JSON.stringify({
          event: "trace_summary_updated",
          traceId,
        });

        await deps.broadcast.broadcastToTenant(
          tenantId,
          payload,
          "trace_updated",
        );

        logger.debug({ tenantId, traceId }, "Broadcasted trace update");
      } catch (error) {
        logger.warn(
          {
            tenantId,
            traceId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to broadcast trace update — non-fatal, at-most-once by design",
        );
      }
    },
  };
}
