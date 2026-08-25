import type { TriggerContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { BroadcastService } from "../../../../app-layer/broadcast/broadcast.service";
import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "../schemas/events";

const logger = createLogger("langwatch:trace-processing:trace-update-broadcast");

export interface TraceUpdateBroadcastSubscriberDeps {
  broadcast: BroadcastService;
}

/**
 * Sized to match the debounce the listener already applies, so neither side
 * dominates. The two are sequential, not shared: this window can hold a
 * broadcast for up to 2s and the listener can then debounce it for up to 2s
 * more, so a watching user sees at most ~4s between a span landing and the
 * view reacting. That is the number to weigh before widening either one.
 */
export const TRACE_UPDATE_BROADCAST_WINDOW_MS = 2_000;

/**
 * Subscriber handler that broadcasts trace updates to connected SSE clients.
 *
 * Fires on ALL event types (recordSpan, assignTopic).
 * The frontend debounces duplicate events.
 * Broadcast failure is swallowed — it must not block the pipeline.
 */
export function createTraceUpdateBroadcastHandler(
  deps: TraceUpdateBroadcastSubscriberDeps,
): (
  event: TraceProcessingEvent,
  context: TriggerContext<TraceSummaryData>,
) => Promise<void> {
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
