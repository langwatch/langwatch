import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { getClickHouseClient } from "~/server/clickhouse/client";
import { createLogger } from "../../../../../utils/logger";
import type {
  EventStream,
  Projection,
  ProjectionHandler,
} from "../../../library";
import type { SpanRepository } from "../repositories/spanRepository";
import { SpanRepositoryClickHouse } from "../repositories/spanRepositoryClickHouse";
import { SpanRepositoryMemory } from "../repositories/spanRepositoryMemory";
import type { TraceProcessingEvent } from "../schemas/events";
import { isSpanReceivedEvent } from "../schemas/events";
import { spanStorageProjectionRepository } from "./spanStorageProjectionRepository";

/**
 * Data stored in the span storage projection.
 * Tracks which spans have been stored for this trace.
 */
export interface SpanStorageData {
  traceId: string;
  storedSpanIds: string[];
  lastUpdatedAt: number;
}

/**
 * Projection for tracking span storage.
 */
export interface SpanStorageProjection extends Projection<SpanStorageData> {
  data: SpanStorageData;
}

/**
 * Projection handler that writes spans to ClickHouse idempotently.
 *
 * Receives all SpanReceivedEvents for a trace and writes each span
 * to the ingested_spans table. ClickHouse's primary key ensures
 * idempotency (duplicate inserts are ignored).
 *
 * @example
 * ```typescript
 * // Registered in pipeline
 * .withProjection("spanStorage", SpanStorageProjectionHandler)
 * ```
 */
export class SpanStorageProjectionHandler
  implements ProjectionHandler<TraceProcessingEvent, SpanStorageProjection>
{
  static readonly store = spanStorageProjectionRepository;

  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.span-storage-projection",
  );
  private readonly logger = createLogger(
    "langwatch:trace-processing:span-storage-projection",
  );
  private readonly spanRepository: SpanRepository;

  constructor() {
    const clickHouseClient = getClickHouseClient();
    this.spanRepository = clickHouseClient
      ? new SpanRepositoryClickHouse(clickHouseClient)
      : new SpanRepositoryMemory();
  }

  handle(
    stream: EventStream<TraceProcessingEvent["tenantId"], TraceProcessingEvent>,
  ): SpanStorageProjection {
    const events = stream.getEvents();
    const aggregateId = stream.getAggregateId();
    const tenantId = stream.getTenantId();

    const storedSpanIds: string[] = [];
    let lastUpdatedAt = Date.now();

    // Process each SpanReceivedEvent
    for (const event of events) {
      if (isSpanReceivedEvent(event)) {
        const { spanData, collectedAtUnixMs } = event.data;

        // Write span to ClickHouse (fire-and-forget, idempotent)
        // Note: We don't await here since projections should be synchronous
        // The actual write happens asynchronously
        void this.writeSpanAsync(String(tenantId), spanData, collectedAtUnixMs);

        storedSpanIds.push(spanData.spanId);
        lastUpdatedAt = event.timestamp;
      }
    }

    return {
      id: `span-storage:${aggregateId}`,
      aggregateId,
      tenantId,
      version: lastUpdatedAt,
      data: {
        traceId: aggregateId,
        storedSpanIds,
        lastUpdatedAt,
      },
    };
  }

  /**
   * Writes a span to storage asynchronously.
   * Errors are logged but don't fail the projection.
   */
  private async writeSpanAsync(
    tenantId: string,
    spanData: TraceProcessingEvent extends { data: { spanData: infer S } }
      ? S
      : never,
    collectedAtUnixMs: number,
  ): Promise<void> {
    try {
      await this.tracer.withActiveSpan(
        "SpanStorageProjectionHandler.writeSpan",
        {
          kind: SpanKind.INTERNAL,
          attributes: {
            "tenant.id": tenantId,
            "span.id": spanData.spanId,
            "trace.id": spanData.traceId,
          },
        },
        async () => {
          await this.spanRepository.insertSpan({
            tenantId,
            spanData,
            collectedAtUnixMs,
          });

          this.logger.debug(
            {
              tenantId,
              spanId: spanData.spanId,
              traceId: spanData.traceId,
            },
            "Span written to storage",
          );
        },
      );
    } catch (error) {
      // Log error but don't fail - ClickHouse insert is idempotent
      // The span will be written on retry if needed
      this.logger.error(
        {
          tenantId,
          spanId: spanData.spanId,
          traceId: spanData.traceId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to write span to storage",
      );
    }
  }
}
