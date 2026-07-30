import { createLogger } from "@langwatch/observability";
import type { BroadcastService } from "../../../../app-layer/broadcast/broadcast.service";
import type { EventSubscriberDefinition } from "../../../subscribers/eventSubscriber.types";
import { SPAN_RECEIVED_EVENT_TYPE } from "../schemas/constants";
import type { TraceProcessingEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:trace-processing:span-storage-broadcast-subscriber",
);

/**
 * Debounce window for the span-level SSE nudge. Shorter than the trace-summary
 * one because span arrival is what a user watching a live trace is waiting on.
 */
export const SPAN_STORAGE_BROADCAST_DEDUP_TTL_MS = 15_000;

export interface SpanStorageBroadcastSubscriberDeps {
  broadcast: BroadcastService;
  /**
   * Without Redis the worker-to-web pub/sub bridge does not exist, so a push
   * emitted here could never reach a browser. `false` disables the subscriber
   * outright rather than emitting into nothing.
   */
  hasRedis?: boolean;
}

/**
 * Pushes a "spans arrived on this trace, refetch it" nudge to whichever SSE
 * clients are connected right now (an event subscriber under ADR-098).
 *
 * **At-most-once, by design — do not make this durable.** There is deliberately
 * no outbox, no retry and no redelivery: a push only means anything to a
 * browser connected at the moment it is sent, and redelivering one to a tab
 * that closed an hour ago is a leak rather than a fix. A lost push is corrected
 * by the client's next refetch, and by the next span on the same trace. That is
 * why a broadcast failure is logged and swallowed rather than thrown — throwing
 * would hand the job back to the queue for redelivery, which is exactly the
 * durability this must not have.
 *
 * Its dedup key is deliberately distinct from `traceUpdateBroadcast`'s so a
 * span arrival and a summary update on the same trace can both push inside one
 * window.
 *
 * Ordering note: as a reactor this ran after the `spanStorage` map projection
 * appended the span, so it meant "the span is in ClickHouse"; as a subscriber
 * it is dispatched from the routing seam, independent of that projection, so it
 * means "a span was received for this trace". That weakening is safe because no
 * reader trusts the push: the payload carries `{ event, traceId }` and nothing
 * else, and `useTraceUpdateListener` only uses the trace id to decide *whether*
 * to refetch — every consumer then reads the store fresh
 * (`SpanTree` → `loader.onSpanStored()`, `MessagesList`/`MessagesTable` →
 * `traceGroups.refetch()`, `useTraceFreshness` → tRPC `invalidate`). A push
 * that lands microseconds ahead of the ClickHouse write costs one empty
 * refetch; the hook's debounce absorbs the common case and the next span on the
 * trace pushes again.
 */
export function createSpanStorageBroadcastSubscriber(
  deps: SpanStorageBroadcastSubscriberDeps,
): EventSubscriberDefinition<TraceProcessingEvent> {
  return {
    name: "spanStorageBroadcast",
    eventTypes: [SPAN_RECEIVED_EVENT_TYPE],
    options: {
      disabled: deps.hasRedis === false,
      deduplication: {
        makeId: (event) =>
          `span-stored:${event.tenantId}:${String(event.aggregateId)}`,
        ttlMs: SPAN_STORAGE_BROADCAST_DEDUP_TTL_MS,
      },
    },

    async handle(event: TraceProcessingEvent): Promise<void> {
      const tenantId = String(event.tenantId);
      const traceId = String(event.aggregateId);

      try {
        const payload = JSON.stringify({
          event: "span_stored",
          traceId,
        });

        await deps.broadcast.broadcastToTenant(
          tenantId,
          payload,
          "trace_updated",
        );

        logger.debug(
          { tenantId, traceId },
          "Broadcasted trace update after span storage",
        );
      } catch (error) {
        logger.warn(
          {
            tenantId,
            traceId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to broadcast trace update after span storage — non-fatal, at-most-once by design",
        );
      }
    },
  };
}
