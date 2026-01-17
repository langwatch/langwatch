import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "../../../../../utils/logger";
import type {
  EventStream,
  Projection,
  ProjectionHandler,
} from "../../../library";
import { traceSummaryRepository } from "../repositories";
import { TRACE_SUMMARY_PROJECTION_VERSION_LATEST } from "../schemas/constants";
import type {
  SpanReceivedEvent,
  TraceProcessingEvent,
} from "../schemas/events";
import { isSpanReceivedEvent } from "../schemas/events";
import type { NormalizedSpan } from "../schemas/spans";
import { SpanNormalizationPipelineService } from "../services";
import { traceAggregationService } from "../services/traceAggregationService";
import { IdUtils } from "../utils/id.utils";

/**
 * Summary data for trace metrics.
 * Matches the trace_summaries ClickHouse table schema exactly.
 */
export interface TraceSummaryData {
  TraceId: string;
  SpanCount: number;
  TotalDurationMs: number;

  // I/O
  ComputedIOSchemaVersion: string;
  ComputedInput: string | null;
  ComputedOutput: string | null;

  // Timing
  TimeToFirstTokenMs: number | null;
  TimeToLastTokenMs: number | null;
  TokensPerSecond: number | null;

  // Status
  ContainsErrorStatus: boolean;
  ContainsOKStatus: boolean;
  ErrorMessage: string | null;
  Models: string[];

  // Cost
  TotalCost: number | null;
  TokensEstimated: boolean;
  TotalPromptTokenCount: number | null;
  TotalCompletionTokenCount: number | null;

  // Trace intelligence (populated later by async processes)
  TopicId: string | null;
  SubTopicId: string | null;
  HasAnnotation: boolean | null;

  // Metadata (stored in Attributes Map)
  // Includes: sdk.name, sdk.version, sdk.language, service.name,
  // thread.id, user.id, customer.id, langgraph.thread_id
  Attributes: Record<string, string>;

  // Timestamps
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
 * Receives all SpanReceivedEvents for a trace, enriches pure span data
 * with computed fields (id, aggregateId, tenantId), and uses the
 * TraceAggregationService to compute metrics.
 *
 * This enables proper event sourcing where events contain only user input
 * and can be replayed with different processing logic.
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

  private readonly spanNormalizationPipelineService =
    new SpanNormalizationPipelineService();
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.trace-summary-projection",
  );
  private readonly logger = createLogger(
    "langwatch:trace-processing:trace-summary-projection",
  );

  handle(
    stream: EventStream<TraceProcessingEvent["tenantId"], TraceProcessingEvent>,
  ): TraceSummary {
    return this.tracer.withActiveSpan(
      "TraceSummaryProjectionHandler.handle",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.id": stream.getAggregateId(),
          "tenant.id": stream.getTenantId(),
          "event.count": stream.getEvents().length,
        },
      },
      (span) => {
        const events = stream.getEvents();
        const aggregateId = stream.getAggregateId();
        const tenantId = stream.getTenantId();

        // Extract and enrich span data from all SpanReceivedEvents
        const normalizedSpans: NormalizedSpan[] = [];
        let createdAt: number | null = null;
        let lastUpdatedAt = Date.now();
        let firstSpanReceivedEvent: SpanReceivedEvent | null = null;

        for (const event of events) {
          if (isSpanReceivedEvent(event)) {
            if (!firstSpanReceivedEvent) firstSpanReceivedEvent = event;

            // Debug: log raw event data
            this.logger.debug(
              {
                spanName: event.data.span.name,
                spanId: event.data.span.spanId,
                eventCount: event.data.span.events?.length ?? 0,
                rawEvents: JSON.stringify(event.data.span.events?.slice(0, 3)),
              },
              "Processing SpanReceivedEvent in projection",
            );

            // Enrich pure span data with computed fields for aggregation
            normalizedSpans.push(
              this.spanNormalizationPipelineService.normalizeSpanReceived(
                event.tenantId,
                event.data.span,
                event.data.resource,
                event.data.instrumentationScope,
              ),
            );

            if (createdAt === null) {
              createdAt = event.timestamp;
            }
            lastUpdatedAt = event.timestamp;
          }
        }

        span.setAttributes({
          "span.count": normalizedSpans.length,
        });

        // If no spans, throw an error
        if (!firstSpanReceivedEvent || normalizedSpans.length === 0) {
          this.logger.debug(
            {
              tenantId,
              aggregateId,
            },
            "No spans found for trace, returning empty projection",
          );

          throw new Error("No spans found for trace");
        }

        // Aggregate spans using the service
        span.addEvent("aggregate.start");
        const aggregatedData =
          traceAggregationService.aggregateTrace(normalizedSpans);

        span.setAttributes({
          "trace.duration_ms": aggregatedData.durationMs,
          "trace.total_spans": aggregatedData.spanCount,
          "trace.total_tokens":
            (aggregatedData.totalPromptTokenCount ?? 0) +
            (aggregatedData.totalCompletionTokenCount ?? 0),
          "trace.total_cost": aggregatedData.totalCost ?? 0,
          "trace.has_error": aggregatedData.containsErrorStatus,
          "trace.input_length": aggregatedData.computedInput?.length ?? 0,
          "trace.output_length": aggregatedData.computedOutput?.length ?? 0,
        });

        this.logger.debug(
          {
            tenantId,
            traceId: aggregatedData.traceId,
            spanCount: aggregatedData.spanCount,
            durationMs: aggregatedData.durationMs,
          },
          "Computed trace summary from span events",
        );

        // Generate deterministic trace summary ID
        const traceSummaryId = IdUtils.generateDeterministicTraceSummaryId(
          firstSpanReceivedEvent,
        );

        span.addEvent("projection.build.complete", {
          "projection.id": traceSummaryId,
        });

        return {
          id: traceSummaryId,
          aggregateId,
          tenantId,
          version: TRACE_SUMMARY_PROJECTION_VERSION_LATEST,
          data: {
            TraceId: aggregatedData.traceId,
            SpanCount: aggregatedData.spanCount,
            TotalDurationMs: aggregatedData.durationMs,

            ComputedIOSchemaVersion: aggregatedData.computedIOSchemaVersion,
            ComputedInput: aggregatedData.computedInput,
            ComputedOutput: aggregatedData.computedOutput,

            TimeToFirstTokenMs: aggregatedData.timeToFirstTokenMs,
            TimeToLastTokenMs: aggregatedData.timeToLastTokenMs,
            TokensPerSecond: aggregatedData.tokensPerSecond,

            ContainsErrorStatus: aggregatedData.containsErrorStatus,
            ContainsOKStatus: aggregatedData.containsOKStatus,
            ErrorMessage: aggregatedData.errorMessage,
            Models: aggregatedData.models,

            TotalCost: aggregatedData.totalCost,
            TokensEstimated: aggregatedData.tokensEstimated,
            TotalPromptTokenCount: aggregatedData.totalPromptTokenCount,
            TotalCompletionTokenCount: aggregatedData.totalCompletionTokenCount,

            // These are populated by async processes later
            TopicId: null,
            SubTopicId: null,
            HasAnnotation: null,

            Attributes: aggregatedData.attributes,

            CreatedAt: createdAt ?? lastUpdatedAt,
            LastUpdatedAt: lastUpdatedAt,
          },
        } satisfies TraceSummary;
      },
    );
  }
}
