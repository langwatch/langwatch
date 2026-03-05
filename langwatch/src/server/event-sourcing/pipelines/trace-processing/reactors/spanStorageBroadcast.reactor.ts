import { createLogger } from "../../../../../utils/logger/server";
import type { BroadcastService } from "../../../../app-layer/broadcast/broadcast.service";
import type { ReactorDefinition } from "../../../reactors/reactor.types";
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
): ReactorDefinition<TraceProcessingEvent> {
  return {
    name: "spanStorageBroadcast",
    options: {
      runIn: ["worker"],
      disabled: deps.hasRedis === false,
      makeJobId: (payload) =>
        `span-stored:${payload.event.tenantId}:${payload.event.aggregateId}`,
      ttl: 1000,
    },

    async handle(event: TraceProcessingEvent): Promise<void> {
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
  };
}
