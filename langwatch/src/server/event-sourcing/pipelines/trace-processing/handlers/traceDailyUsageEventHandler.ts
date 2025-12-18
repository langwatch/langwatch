import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "../../../../../utils/logger";
import type { EventHandler } from "../../../library/domain/handlers/eventHandler";
import type { SpanReceivedEvent } from "../schemas/events";
import { SPAN_RECEIVED_EVENT_TYPE } from "../schemas/constants";
import { SpanNormalizationPipelineService } from "../services/spanNormalizationPipelineService";
import { TraceRequestUtils } from "../utils/traceRequest.utils";
import { traceDailyUsageRepository } from "../repositories";

/**
 * Event handler that maintains daily trace usage counts per tenant.
 * Ensures each trace is counted exactly once per day through idempotent operations.
 *
 * Business Logic:
 * - Extracts trace ID and event timestamp
 * - Normalizes date to day boundary
 * - Ensures trace is counted exactly once for tenant-day combination
 * - Handles multiple spans per trace gracefully
 */
export class TraceDailyUsageEventHandler
  implements EventHandler<SpanReceivedEvent>
{
  private readonly spanNormalizationPipelineService =
    new SpanNormalizationPipelineService();
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.trace-daily-usage-handler"
  );
  private readonly logger = createLogger(
    "langwatch:trace-processing:trace-daily-usage-handler"
  );

  /**
   * Processes a span received event to update daily usage counts.
   * Idempotent - multiple calls for same trace are safe.
   */
  async handle(event: SpanReceivedEvent): Promise<void> {
    return await this.tracer.withActiveSpan(
      "TraceDailyUsageEventHandler.handle",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "event.id": event.id,
          "event.type": event.type,
          "tenant.id": event.tenantId,
          "trace.id": TraceRequestUtils.normalizeOtlpId(
            event.data.span.traceId
          ),
          "span.id": TraceRequestUtils.normalizeOtlpId(event.data.span.spanId),
        },
      },
      async (span) => {
        const traceId = TraceRequestUtils.normalizeOtlpId(event.data.span.traceId);

        // Normalize timestamp to day boundary for consistent daily aggregation
        const eventDate = new Date(event.timestamp);
        const date = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());

        this.logger.debug(
          {
            tenantId: event.tenantId,
            traceId,
            eventDate: eventDate.toISOString(),
            normalizedDate: date.toISOString().split('T')[0],
          },
          "Processing trace for daily usage tracking"
        );

        try {
          const wasCounted = await traceDailyUsageRepository.ensureTraceCounted(
            event.tenantId,
            traceId,
            date
          );

          span.setAttributes({
            "usage.trace_counted": wasCounted,
            "usage.trace_already_counted": !wasCounted,
          });

          if (wasCounted) {
            this.logger.info(
              {
                tenantId: event.tenantId,
                traceId,
                date: date.toISOString().split('T')[0],
              },
              "Incremented daily trace count for tenant"
            );
          } else {
            this.logger.debug(
              {
                tenantId: event.tenantId,
                traceId,
                date: date.toISOString().split('T')[0],
              },
              "Trace already counted for this tenant-day, skipping"
            );
          }
        } catch (error) {
          this.logger.error(
            {
              tenantId: event.tenantId,
              traceId,
              date: date.toISOString().split('T')[0],
              error: error instanceof Error ? error.message : String(error),
            },
            "Failed to update daily usage tracking"
          );
          throw error;
        }
      }
    );
  }

  /**
   * Returns the event types this handler processes.
   */
  getEventTypes(): readonly ["lw.obs.trace.span_received"] {
    return [SPAN_RECEIVED_EVENT_TYPE] as const;
  }

  /**
   * Returns enriched span data for debugging tools.
   */
  getDisplayData(event: SpanReceivedEvent) {
    return this.spanNormalizationPipelineService.normalizeSpanReceived(
      event.tenantId,
      event.data.span,
      event.data.resource,
      event.data.instrumentationScope,
    );
  }
}
