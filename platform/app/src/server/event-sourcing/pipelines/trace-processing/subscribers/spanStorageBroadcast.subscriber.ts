import type { TriggerContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { BroadcastService } from "../../../../app-layer/broadcast/broadcast.service";
import type { TraceProcessingEvent } from "@langwatch/trace-contract";

const logger = createLogger("langwatch:trace-processing:span-storage-broadcast");

export const SPAN_STORAGE_BROADCAST_DEDUP_TTL_MS = 15_000; // Debounce — notification only, frontend refetches

export interface SpanStorageBroadcastSubscriberDeps {
  broadcast: BroadcastService;
}

/**
 * Subscriber handler that broadcasts span storage events to connected SSE
 * clients.
 *
 * Registered on the spanStorage map projection; the subscriber-scoped dedup
 * key keeps it independent of the fold-based traceUpdateBroadcast subscriber
 * so both event types can fire within the same TTL window.
 */
export function createSpanStorageBroadcastHandler(
  deps: SpanStorageBroadcastSubscriberDeps,
): (event: TraceProcessingEvent, context: TriggerContext<unknown>) => Promise<void> {
  return async (event) => {
    const tenantId = event.tenantId;
    const traceId = String(event.aggregateId);

    try {
      const payload = JSON.stringify({
        event: "span_stored",
        traceId,
      });

      await deps.broadcast.broadcastToTenant(tenantId, payload, "trace_updated");

      logger.debug({ tenantId, traceId }, "Broadcasted trace update after span storage");
    } catch (error) {
      logger.warn(
        {
          tenantId,
          traceId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to broadcast trace update after span storage — non-fatal",
      );
    }
  };
}
