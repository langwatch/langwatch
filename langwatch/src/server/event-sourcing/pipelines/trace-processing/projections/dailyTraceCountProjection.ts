import { createLogger } from "../../../../../utils/logger";
import type {
  EventStream,
  Projection,
  ProjectionHandler,
} from "../../../library";
import { dailyTraceCountRepository } from "../repositories";
import type { TraceProcessingEvent } from "../schemas/events";
import { isSpanReceivedEvent } from "../schemas/events";

/**
 * Data for daily trace count projection.
 * Stores the trace ID and date for aggregation in ClickHouse.
 */
export interface DailyTraceCountData {
  DateUtc: string;
  TraceId: string;
  LastUpdatedAt: number;
}

/**
 * Daily trace count projection for usage statistics.
 */
export interface DailyTraceCount extends Projection<DailyTraceCountData> {
  data: DailyTraceCountData;
}

/**
 * Converts a timestamp to a UTC date string (YYYY-MM-DD).
 */
function timestampToUtcDate(timestampMs: number): string {
  const date = new Date(timestampMs);
  return date.toISOString().split("T")[0]!;
}

/**
 * Projection handler that emits daily trace counts for usage statistics.
 *
 * Receives SpanReceivedEvents for a trace and extracts the trace's creation
 * date (UTC) from the first span event. The repository handles aggregation
 * using ClickHouse's uniqState function for idempotent unique counting.
 *
 * @example
 * ```typescript
 * // Registered in pipeline
 * .withProjection("dailyTraceCount", DailyTraceCountProjectionHandler)
 * ```
 */
export class DailyTraceCountProjectionHandler
  implements ProjectionHandler<TraceProcessingEvent, DailyTraceCount>
{
  static readonly store = dailyTraceCountRepository;

  private readonly logger = createLogger(
    "langwatch:trace-processing:daily-trace-count-projection",
  );

  handle(
    stream: EventStream<
      TraceProcessingEvent["tenantId"],
      TraceProcessingEvent
    >,
  ): DailyTraceCount {
    const events = stream.getEvents();
    const aggregateId = stream.getAggregateId();
    const tenantId = stream.getTenantId();

    // Find the first span event to determine the trace creation date
    let createdAt: number | null = null;

    for (const event of events) {
      if (isSpanReceivedEvent(event)) {
        if (createdAt === null) {
          createdAt = event.timestamp;
        }
      }
    }

    const now = Date.now();
    const traceCreationTimestamp = createdAt ?? now;
    const dateUtc = timestampToUtcDate(traceCreationTimestamp);

    this.logger.debug(
      {
        tenantId,
        traceId: aggregateId,
        dateUtc,
      },
      "Computed daily trace count projection",
    );

    return {
      id: `daily_trace_count:${tenantId}:${dateUtc}:${aggregateId}`,
      aggregateId,
      tenantId,
      version: now,
      data: {
        DateUtc: dateUtc,
        TraceId: aggregateId,
        LastUpdatedAt: now,
      },
    };
  }
}
