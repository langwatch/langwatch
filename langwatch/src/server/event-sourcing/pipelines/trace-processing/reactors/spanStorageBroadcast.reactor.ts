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
 * Reactor that broadcasts trace updates after span storage completes.
 *
 * Shares the same dedup key (`trace-update:{tenantId}:{traceId}`) and TTL as
 * the fold-based traceUpdateBroadcast reactor. This means at most ONE broadcast
 * fires per trace per second — whichever projection (fold or map) completes last
 * within the TTL window triggers the actual broadcast.
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
        `trace-update:${payload.event.tenantId}:${payload.event.aggregateId}`,
      ttl: 1000,
    },

    async handle(event: TraceProcessingEvent): Promise<void> {
      const tenantId = event.tenantId;
      const traceId = String(event.aggregateId);

      try {
        const payload = JSON.stringify({
          event: "trace_updated",
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
