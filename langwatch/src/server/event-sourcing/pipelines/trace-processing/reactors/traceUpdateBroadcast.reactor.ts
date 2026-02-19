import { createLogger } from "../../../../../utils/logger/server";
import type { BroadcastService } from "../../../../app-layer/broadcast/broadcast.service";
import type { ReactorContext, ReactorDefinition } from "../../../reactors/reactor.types";
import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:trace-processing:trace-update-broadcast-reactor",
);

export interface TraceUpdateBroadcastReactorDeps {
  broadcast: BroadcastService;
  hasRedis?: boolean;
}

/**
 * Reactor that broadcasts trace updates to connected SSE clients.
 *
 * Fires on ALL event types (recordSpan, assignTopic).
 * The frontend debounces duplicate events.
 * Broadcast failure is swallowed — it must not block the pipeline.
 */
export function createTraceUpdateBroadcastReactor(
  deps: TraceUpdateBroadcastReactorDeps,
): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return {
    name: "traceUpdateBroadcast",
    options: {
      runIn: ["worker"],
      // Without Redis, worker-to-web pub/sub bridge is unavailable
      disabled: deps.hasRedis === false,
      makeJobId: (payload) =>
        `trace-update:${payload.event.tenantId}:${payload.event.aggregateId}`,
      ttl: 1000, // Debounce broadcasts slightly
    },

    async handle(
      _event: TraceProcessingEvent,
      context: ReactorContext<TraceSummaryData>,
    ): Promise<void> {
      const { tenantId, aggregateId: traceId } = context;

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
          {
            tenantId,
            traceId,
          },
          "Broadcasted trace update",
        );
      } catch (error) {
        logger.warn(
          {
            tenantId,
            traceId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to broadcast trace update — non-fatal",
        );
      }
    },
  };
}
