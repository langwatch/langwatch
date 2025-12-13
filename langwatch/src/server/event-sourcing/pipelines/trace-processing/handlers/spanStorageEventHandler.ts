import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "../../../../../utils/logger";
import type { EventHandler } from "../../../library/domain/handlers/eventHandler";
import { spanRepository } from "../repositories";
import type { SpanReceivedEvent } from "../schemas/events";
import { SPAN_RECEIVED_EVENT_TYPE } from "../schemas/events";
import { SpanEnrichmentUtils } from "../utils/spanEnrichment.utils";

/**
 * Event handler that writes individual spans to the stored_spans table.
 * Triggered for each SpanReceivedEvent in the trace-processing pipeline.
 *
 * Enriches pure span data from events with computed fields (id, aggregateId, tenantId)
 * before storing. This enables proper event sourcing where events contain only user input
 * and can be replayed with different processing logic.
 *
 * This materializes the read model (stored_spans) from the event stream,
 * following the CQRS pattern where event handlers maintain read models.
 *
 * @example
 * ```typescript
 * // Registered in pipeline
 * .withEventHandler("spanStorage", SpanStorageEventHandler, {
 *   eventTypes: [SPAN_RECEIVED_EVENT_TYPE],
 * })
 * ```
 */
export class SpanStorageEventHandler
  implements EventHandler<SpanReceivedEvent>
{
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.span-storage-handler",
  );
  private readonly logger = createLogger(
    "langwatch:trace-processing:span-storage-handler",
  );

  /**
   * Handles a SpanReceivedEvent by enriching span data and writing to stored_spans.
   * Enriches pure span data from the event with computed fields before storage.
   *
   * @param event - The SpanReceivedEvent containing pure span data
   */
  async handle(event: SpanReceivedEvent): Promise<void> {
    return await this.tracer.withActiveSpan(
      "SpanStorageEventHandler.handle",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "event.id": event.id,
          "event.type": event.type,
          "tenant.id": event.tenantId,
          "trace.id": event.data.spanData.traceId,
          "span.id": event.data.spanData.spanId,
        },
      },
      async (span) => {
        const { spanData: pureSpanData, collectedAtUnixMs } = event.data;

        // Enrich pure span data with computed fields for storage
        const enrichedSpanData = SpanEnrichmentUtils.enrichSpanData(
          pureSpanData,
          event,
        );

        span.setAttributes({
          "span.record_id": enrichedSpanData.id,
        });

        this.logger.debug(
          {
            tenantId: event.tenantId,
            traceId: pureSpanData.traceId,
            spanId: pureSpanData.spanId,
            eventId: event.id,
            spanRecordId: enrichedSpanData.id,
          },
          "Writing span to stored_spans",
        );

        try {
          span.addEvent("span.storage.start");

          await spanRepository.insertSpan({
            tenantId: String(event.tenantId),
            spanData: enrichedSpanData,
            collectedAtUnixMs,
          });

          span.addEvent("span.storage.complete");

          this.logger.debug(
            {
              tenantId: event.tenantId,
              traceId: pureSpanData.traceId,
              spanId: pureSpanData.spanId,
              spanRecordId: enrichedSpanData.id,
            },
            "Successfully wrote span to stored_spans",
          );
        } catch (error) {
          span.addEvent("span.storage.error", {
            "error.message":
              error instanceof Error ? error.message : String(error),
          });

          this.logger.error(
            {
              tenantId: event.tenantId,
              traceId: pureSpanData.traceId,
              spanId: pureSpanData.spanId,
              error: error instanceof Error ? error.message : String(error),
            },
            "Failed to write span to stored_spans",
          );
          throw error;
        }
      },
    );
  }

  /**
   * Returns the event types this handler is interested in.
   * Only processes SpanReceivedEvent.
   */
  getEventTypes(): readonly ["lw.obs.trace.span_received"] {
    return [SPAN_RECEIVED_EVENT_TYPE];
  }

  /**
   * Returns enriched span data for display in debugging tools like deja-view.
   * This shows the span data that would be stored by this handler.
   */
  getDisplayData(event: SpanReceivedEvent) {
    const enrichedSpanData = SpanEnrichmentUtils.enrichSpanData(
      event.data.spanData,
      event,
    );
    return enrichedSpanData;
  }
}
