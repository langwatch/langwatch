import { createLogger } from "../../../../../utils/logger";
import type {
  EventStream,
  Projection,
  ProjectionHandler,
} from "../../../library";
import type { SpanData } from "../schemas/commands";
import type { SpanStorageEvent } from "../schemas/events";
import { isSpanStoredEvent } from "../schemas/events";
import { spanProjectionStore } from "../repositories";

/**
 * Data stored in the span projection.
 * This matches the ingested_spans table schema.
 */
export interface SpanProjectionData {
  spanData: SpanData;
  collectedAtUnixMs: number;
}

/**
 * Projection for storing individual spans.
 */
export interface SpanProjection extends Projection<SpanProjectionData> {
  data: SpanProjectionData;
}

/**
 * Projection handler that computes span projections from span events.
 *
 * This is a pure function that transforms events into projection data.
 * The projection store handles persistence to the ingested_spans table.
 *
 * @example
 * ```typescript
 * // Registered in pipeline
 * .withProjection("span", SpanProjectionHandler)
 * ```
 */
export class SpanProjectionHandler
  implements ProjectionHandler<SpanStorageEvent, SpanProjection>
{
  static readonly store = spanProjectionStore;

  private readonly logger = createLogger(
    "langwatch:span-storage:span-projection",
  );

  handle(
    stream: EventStream<SpanStorageEvent["tenantId"], SpanStorageEvent>,
  ): SpanProjection {
    const events = stream.getEvents();
    const aggregateId = stream.getAggregateId();
    const tenantId = stream.getTenantId();

    // For span-level aggregates, there should be exactly one event per span
    const spanEvent = events.find(isSpanStoredEvent);

    if (!spanEvent) {
      this.logger.warn(
        {
          tenantId,
          aggregateId,
          eventCount: events.length,
        },
        "No SpanStoredEvent found for span aggregate",
      );

      // Return empty projection - this shouldn't happen in normal operation
      const now = Date.now();
      return {
        id: `span:${aggregateId}`,
        aggregateId,
        tenantId,
        version: now,
        data: {
          spanData: {} as SpanData,
          collectedAtUnixMs: now,
        },
      };
    }

    const { spanData, collectedAtUnixMs } = spanEvent.data;

    this.logger.debug(
      {
        tenantId,
        traceId: spanData.traceId,
        spanId: spanData.spanId,
      },
      "Computed span projection from event",
    );

    return {
      id: spanData.id,
      aggregateId,
      tenantId,
      version: spanEvent.timestamp,
      data: {
        spanData,
        collectedAtUnixMs,
      },
    };
  }
}

