import { createLogger } from "@langwatch/observability";
import type { BroadcastService } from "../../../../app-layer/broadcast/broadcast.service";
import type { TraceSummarySubscriber } from "./_originGuardedSubscriber";

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
): TraceSummarySubscriber {
  return {
    name: "traceUpdateBroadcast",
    spec: {
      fold: "traceSummary",
      // Without Redis, worker-to-web pub/sub bridge is unavailable
      when: () => deps.hasRedis !== false,
      ttl: 30_000, // Debounce broadcasts — frontend already debounces duplicate events
      handler: async (_event, context) => {
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
    },
  };
}
