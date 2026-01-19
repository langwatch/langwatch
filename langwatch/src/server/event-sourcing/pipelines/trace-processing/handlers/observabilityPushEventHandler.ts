import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { sseService } from "../../../../../server/services/sse.service";
import { createLogger } from "../../../../../utils/logger";
import type { EventHandler } from "../../../library/domain/handlers/eventHandler";
import { SPAN_RECEIVED_EVENT_TYPE } from "../schemas/constants";
import type { SpanReceivedEvent } from "../schemas/events";

/**
 * Event handler that broadcasts trace update notifications via SSE.
 * Triggers real-time updates in the frontend when new spans are ingested.
 *
 * This handler simply notifies that new trace data is available,
 * without parsing or processing the span data itself.
 */
export class ObservabilityPushEventHandler
  implements EventHandler<SpanReceivedEvent>
{
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.span-sse-handler",
  );
  private readonly logger = createLogger(
    "langwatch:trace-processing:span-sse-handler",
  );

  /**
   * Handles a SpanReceivedEvent by broadcasting an update notification.
   */
  async handle(event: SpanReceivedEvent): Promise<void> {
    return await this.tracer.withActiveSpan(
      "SpanSseEventHandler.handle",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "event.id": event.id,
          "event.type": event.type,
          "tenant.id": event.tenantId,
        },
      },
      async (span) => {
        this.logger.info(
          {
            tenantId: event.tenantId,
            eventId: event.id,
          },
          "Broadcasting trace update notification",
        );

        try {
          await sseService.broadcastToTenant(event.tenantId, "trace_updated");

          span.addEvent("sse.broadcast.success");

          this.logger.info(
            {
              tenantId: event.tenantId,
            },
            "Successfully broadcast trace update notification",
          );
        } catch (error) {
          span.addEvent("sse.broadcast.error", {
            "error.message":
              error instanceof Error ? error.message : String(error),
          });

          this.logger.error(
            {
              tenantId: event.tenantId,
              error: error instanceof Error ? error.message : String(error),
            },
            "Failed to broadcast trace update notification",
          );
          // Don't throw - SSE failures shouldn't fail event processing
        }
      },
    );
  }

  getEventTypes(): readonly ["lw.obs.trace.span_received"] {
    return [SPAN_RECEIVED_EVENT_TYPE] as const;
  }

  getDisplayData(event: SpanReceivedEvent) {
    return {
      tenantId: event.tenantId,
      eventType: "trace_updated",
      notification: "Trace data updated",
    };
  }
}
