import { createLogger } from "../../../../../utils/logger";
import type {
  EventStream,
  Projection,
  ProjectionHandler,
} from "../../../library";
import { traceSummaryRepository } from "../repositories";
import type { SpanData } from "../schemas/commands";
import type { TraceProcessingEvent } from "../schemas/events";
import { isSpanReceivedEvent } from "../schemas/events";
import { traceAggregationService } from "../services/traceAggregationService";

/**
 * Summary data for trace metrics.
 * Matches the trace_summaries ClickHouse table schema.
 */
export interface TraceSummaryData {
  TraceId: string;
  SpanCount: number;
  TotalDurationMs: number;
  IOSchemaVersion: string;
  ComputedInput: string | null;
  ComputedOutput: string | null;
  ComputedMetadata: Record<string, string>;
  TimeToFirstTokenMs: number | null;
  TimeToLastTokenMs: number | null;
  TokensPerSecond: number | null;
  ContainsErrorStatus: boolean;
  ContainsOKStatus: boolean;
  Models: string[];
  TopicId: string | null;
  SubTopicId: string | null;
  TotalPromptTokenCount: number | null;
  TotalCompletionTokenCount: number | null;
  HasAnnotation: boolean | null;
  CreatedAt: number;
  LastUpdatedAt: number;
}

/**
 * Summary projection for trace metrics.
 */
export interface TraceSummary extends Projection<TraceSummaryData> {
  data: TraceSummaryData;
}

/**
 * Projection handler that computes trace summaries from span events.
 *
 * Receives all SpanReceivedEvents for a trace, extracts the span data,
 * and uses the TraceAggregationService to compute metrics.
 *
 * @example
 * ```typescript
 * // Registered in pipeline
 * .withProjection("traceSummary", TraceSummaryProjectionHandler)
 * ```
 */
export class TraceSummaryProjectionHandler
  implements ProjectionHandler<TraceProcessingEvent, TraceSummary>
{
  static readonly store = traceSummaryRepository;

  private readonly logger = createLogger(
    "langwatch:trace-processing:trace-summary-projection",
  );

  handle(
    stream: EventStream<
      TraceProcessingEvent["tenantId"],
      TraceProcessingEvent
    >,
  ): TraceSummary {
    const events = stream.getEvents();
    const aggregateId = stream.getAggregateId();
    const tenantId = stream.getTenantId();

    // Extract span data from all SpanReceivedEvents
    const spans: SpanData[] = [];
    let createdAt: number | null = null;
    let lastUpdatedAt = Date.now();

    for (const event of events) {
      if (isSpanReceivedEvent(event)) {
        spans.push(event.data.spanData);
        
        if (createdAt === null) {
          createdAt = event.timestamp;
        }
        lastUpdatedAt = event.timestamp;
      }
    }

    // If no spans, return empty projection
    if (spans.length === 0) {
      const now = Date.now();
      this.logger.debug(
        {
          tenantId,
          aggregateId,
        },
        "No spans found for trace, returning empty projection",
      );

      return {
        id: `trace:${aggregateId}`,
        aggregateId,
        tenantId,
        version: now,
        data: {
          TraceId: aggregateId,
          SpanCount: 0,
          TotalDurationMs: 0,
          IOSchemaVersion: "1.0",
          ComputedInput: null,
          ComputedOutput: null,
          ComputedMetadata: {},
          TimeToFirstTokenMs: null,
          TimeToLastTokenMs: null,
          TokensPerSecond: null,
          ContainsErrorStatus: false,
          ContainsOKStatus: false,
          Models: [],
          TopicId: null,
          SubTopicId: null,
          TotalPromptTokenCount: null,
          TotalCompletionTokenCount: null,
          HasAnnotation: null,
          CreatedAt: now,
          LastUpdatedAt: now,
        },
      };
    }

    // Aggregate spans using the service
    const aggregatedData = traceAggregationService.aggregateTrace(spans);

    this.logger.debug(
      {
        tenantId,
        traceId: aggregatedData.traceId,
        spanCount: aggregatedData.totalSpans,
        durationMs: aggregatedData.durationMs,
      },
      "Computed trace summary from span events",
    );

    return {
      id: `trace:${aggregatedData.traceId}`,
      aggregateId,
      tenantId,
      version: lastUpdatedAt,
      data: {
        TraceId: aggregatedData.traceId,
        SpanCount: aggregatedData.totalSpans,
        TotalDurationMs: aggregatedData.durationMs,
        IOSchemaVersion: aggregatedData.IOSchemaVersion,
        ComputedInput: aggregatedData.ComputedInput,
        ComputedOutput: aggregatedData.ComputedOutput,
        ComputedMetadata: aggregatedData.ComputedMetadata,
        TimeToFirstTokenMs: aggregatedData.TimeToFirstTokenMs,
        TimeToLastTokenMs: aggregatedData.TimeToLastTokenMs,
        TokensPerSecond: aggregatedData.TokensPerSecond,
        ContainsErrorStatus: aggregatedData.ContainsErrorStatus,
        ContainsOKStatus: aggregatedData.ContainsOKStatus,
        Models: aggregatedData.Models,
        TopicId: aggregatedData.TopicId,
        SubTopicId: aggregatedData.SubTopicId,
        TotalPromptTokenCount: aggregatedData.TotalPromptTokenCount,
        TotalCompletionTokenCount: aggregatedData.TotalCompletionTokenCount,
        HasAnnotation: aggregatedData.HasAnnotation,
        CreatedAt: createdAt ?? lastUpdatedAt,
        LastUpdatedAt: lastUpdatedAt,
      },
    };
  }
}

