import type { SpanData } from "../../span-ingestion/schemas/commands";
import type { TraceAggregationCompletedEventData } from "../schemas/events";
import { createLogger } from "../../../../../utils/logger";

/**
 * Service that handles the business logic of aggregating spans into trace metadata.
 */
export class TraceAggregationService {
  logger = createLogger("langwatch:trace-aggregation-service");

  /**
   * Validates that a timestamp is valid (not 0, null, undefined, or negative).
   */
  private isValidTimestamp(timestamp: number | undefined | null): boolean {
    return (
      typeof timestamp === "number" &&
      timestamp > 0 &&
      isFinite(timestamp) &&
      !isNaN(timestamp)
    );
  }

  /**
   * Aggregates spans into trace metadata.
   * Computes total spans, duration, service names, root span ID, start/end times, etc.
   */
  aggregateTrace(spans: SpanData[]): TraceAggregationCompletedEventData {
    if (spans.length === 0 || !spans[0]) {
      throw new Error("Cannot aggregate trace with no spans");
    }

    // Filter out spans with invalid timestamps and log warnings
    const spansWithValidTimestamps = spans.filter((span) => {
      const hasValidStart = this.isValidTimestamp(span.startTimeUnixMs);
      const hasValidEnd = this.isValidTimestamp(span.endTimeUnixMs);

      if (!hasValidStart || !hasValidEnd) {
        this.logger.warn(
          {
            traceId: span.traceId,
            spanId: span.spanId,
            startTimeUnixMs: span.startTimeUnixMs,
            endTimeUnixMs: span.endTimeUnixMs,
          },
          "Span has invalid timestamps, excluding from aggregation",
        );
        return false;
      }

      return true;
    });

    if (spansWithValidTimestamps.length === 0) {
      throw new Error(
        "Cannot aggregate trace: all spans have invalid timestamps",
      );
    }

    const spanIds = spans.map((span) => span.spanId);
    const totalSpans = spans.length;

    // Find start and end times using only spans with valid timestamps
    const validStartTimes = spansWithValidTimestamps.map(
      (span) => span.startTimeUnixMs,
    );
    const validEndTimes = spansWithValidTimestamps.map(
      (span) => span.endTimeUnixMs,
    );

    const startTimeUnixMs = Math.min(...validStartTimes);
    const endTimeUnixMs = Math.max(...validEndTimes);
    const durationMs = endTimeUnixMs - startTimeUnixMs;

    // Extract unique service names from resource attributes
    const serviceNamesSet = new Set<string>();
    for (const span of spans) {
      const serviceName = span.resourceAttributes?.["service.name"];
      if (typeof serviceName === "string" && serviceName) {
        serviceNamesSet.add(serviceName);
      }
    }
    const serviceNames = Array.from(serviceNamesSet).sort();

    // Find root span (span with no parent or parent not in this trace)
    const spanIdsSet = new Set(spanIds);
    let rootSpanId: string | null = null;
    for (const span of spans) {
      if (!span.parentSpanId || !spanIdsSet.has(span.parentSpanId)) {
        rootSpanId = span.spanId;
        break;
      }
    }
    // If no root found, use the first span
    if (!rootSpanId && spans.length > 0) {
      rootSpanId = spans[0].spanId;
    }

    // Use the traceId from the first span (all spans should have the same traceId)
    const traceId = spans[0].traceId;

    return {
      traceId,
      spanIds,
      totalSpans,
      startTimeUnixMs,
      endTimeUnixMs,
      durationMs,
      serviceNames,
      rootSpanId,
    };
  }
}

export const traceAggregationService = new TraceAggregationService();
