import type { TriggerContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { TraceSummaryData,TraceProcessingEvent } from "@langwatch/trace-contract";
import type { TraceTenantBroadcast } from "../app/trace.members.ts";

const logger = createLogger("langwatch:trace-processing:trace-update-broadcast");

export interface TraceUpdateBroadcastSubscriberDeps {
  broadcast: TraceTenantBroadcast;
}

/**
 * Sized to match the debounce the listener already applies. Sequential, not
 * shared: up to 2s here, then up to 2s more in the listener, so a watching
 * user sees at most ~4s between a span landing and the view reacting.
 */
export const TRACE_UPDATE_BROADCAST_WINDOW_MS = 2_000;

/**
 * Broadcasts trace updates to connected SSE clients on ALL event types
 * (recordSpan, assignTopic); the frontend debounces duplicates. Broadcast
 * failure is swallowed — it must not block the pipeline.
 */
export function createTraceUpdateBroadcastHandler(
  deps: TraceUpdateBroadcastSubscriberDeps,
): (event: TraceProcessingEvent, context: TriggerContext<TraceSummaryData>) => Promise<void> {
  return async (_event, context) => {
    const { tenantId, aggregateId: traceId } = context;

    try {
      const payload = JSON.stringify({
        event: "trace_summary_updated",
        traceId,
      });

      await deps.broadcast.broadcastToTenant(tenantId, payload, "trace_updated");

      logger.debug({ tenantId, traceId }, "Broadcasted trace update");
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
  };
}
