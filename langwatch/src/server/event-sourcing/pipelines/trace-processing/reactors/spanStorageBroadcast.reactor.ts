import { createLogger } from "@langwatch/observability";
import type { BroadcastService } from "../../../../app-layer/broadcast/broadcast.service";
import type { SubscriberSpec } from "../../../pipeline/processManagerDefinition";
import type { TraceProcessingEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:trace-processing:span-storage-broadcast-reactor",
);

export interface SpanStorageBroadcastReactorDeps {
  broadcast: BroadcastService;
  hasRedis?: boolean;
}

/**
 * Reactor that broadcasts span storage events to connected SSE clients.
 *
 * Uses a separate dedup key (`span-stored:{tenantId}:{traceId}`) from the
 * fold-based traceUpdateBroadcast reactor so both event types can fire
 * independently within the same TTL window.
 */
export function createSpanStorageBroadcastReactor(
  deps: SpanStorageBroadcastReactorDeps,
): { name: string; spec: SubscriberSpec<TraceProcessingEvent> } {
  return {
    name: "spanStorageBroadcast",
    spec: {
      map: "spanStorage",
      // Without Redis, worker-to-web pub/sub bridge is unavailable
      when: () => deps.hasRedis !== false,
      ttl: 15_000, // Debounce — notification only, frontend refetches
      handler: async (event) => {
        const tenantId = event.tenantId;
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
            "Failed to broadcast trace update after span storage — non-fatal",
          );
        }
      },
    },
  };
}
