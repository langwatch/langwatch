import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "../../../../../utils/logger";
import type {
  EventStream,
  Projection,
  ProjectionHandler,
} from "../../../library";
import { traceSummaryRepository } from "../repositories";
import type {
  SpanReceivedEvent,
  TraceProcessingEvent,
} from "../schemas/events";
import { isSpanReceivedEvent } from "../schemas/events";
// import { traceAggregationService } from "../services/traceAggregationService";
import { SpanNormalizationPipelineService } from "../services";
import { IdUtils } from "../utils/id.utils";
import type { NormalizedSpan } from "../schemas/spans";
import { TRACE_SUMMARY_PROJECTION_VERSION_LATEST } from "../schemas/constants";

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
  ComputedAttributes: Record<string, string>;
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

  // Reserved trace metadata
  ThreadId: string | null;
  UserId: string | null;
  CustomerId: string | null;
  Labels: string[];
  PromptIds: string[];
  PromptVersionIds: string[];

  // Additional attributes (SDK info and other metadata)
  Attributes: Record<string, string>;

  // Cost metrics
  TotalCost: number | null;
  TokensEstimated: boolean;

  // Error details
  ErrorMessage: string | null;
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

  private readonly spanNormalizationPipelineService = new SpanNormalizationPipelineService();
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.trace-summary-projection"
  );
  private readonly logger = createLogger(
    "langwatch:trace-processing:trace-summary-projection"
  );

  handle(
    stream: EventStream<TraceProcessingEvent["tenantId"], TraceProcessingEvent>
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

            // Enrich pure span data with computed fields for aggregation
            normalizedSpans.push(
              this.spanNormalizationPipelineService.normalizeSpanReceived(
                event.tenantId,
                event.data.span,
                event.data.resource,
                event.data.instrumentationScope,
              )
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

        // If no spans, return empty projection
        if (!firstSpanReceivedEvent || normalizedSpans.length === 0) {
          this.logger.debug(
            {
              tenantId,
              aggregateId,
            },
            "No spans found for trace, returning empty projection"
          );

          throw new Error("No spans found for trace");
        }

        // Aggregate spans using the service
        // span.addEvent("aggregate.start");
        // const aggregatedData =
        //   traceAggregationService.aggregateTrace(normalizedSpans);

        // span.setAttributes({
        //   "trace.duration_ms": aggregatedData.durationMs,
        //   "trace.total_spans": aggregatedData.totalSpans,
        //   "trace.total_tokens":
        //     (aggregatedData.TotalPromptTokenCount ?? 0) +
        //     (aggregatedData.TotalCompletionTokenCount ?? 0),
        //   "trace.total_cost": aggregatedData.TotalCost ?? 0,
        //   "trace.has_error": aggregatedData.ContainsErrorStatus,
        //   "trace.input_length": aggregatedData.ComputedInput?.length ?? 0,
        //   "trace.output_length": aggregatedData.ComputedOutput?.length ?? 0,
        // });

        // this.logger.debug(
        //   {
        //     tenantId,
        //     traceId: aggregatedData.traceId,
        //     spanCount: aggregatedData.totalSpans,
        //     durationMs: aggregatedData.durationMs,
        //   },
        //   "Computed trace summary from span events"
        // );

        // Generate deterministic trace summary ID
        const traceSummaryId = IdUtils.generateDeterministicTraceSummaryId(
          firstSpanReceivedEvent
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
            TraceId: "",
            SpanCount: 0,
            TotalDurationMs: 0,
            IOSchemaVersion: "",
            ComputedInput: "",
            ComputedOutput: "",
            ComputedAttributes: {},
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
            CreatedAt: 0,
            LastUpdatedAt: lastUpdatedAt,
            ThreadId: null,
            UserId: "",
            CustomerId: null,
            Labels: [],
            PromptIds: [],
            PromptVersionIds: [],
            Attributes: {},
            TotalCost: null,
            TokensEstimated: false,
            ErrorMessage: null,

            // TraceId: aggregatedData.traceId,
            // SpanCount: aggregatedData.totalSpans,
            // TotalDurationMs: aggregatedData.durationMs,
            // IOSchemaVersion: aggregatedData.IOSchemaVersion,
            // ComputedInput: aggregatedData.ComputedInput,
            // ComputedOutput: aggregatedData.ComputedOutput,
            // ComputedAttributes: aggregatedData.ComputedAttributes,
            // TimeToFirstTokenMs: aggregatedData.TimeToFirstTokenMs,
            // TimeToLastTokenMs: aggregatedData.TimeToLastTokenMs,
            // TokensPerSecond: aggregatedData.TokensPerSecond,
            // ContainsErrorStatus: aggregatedData.ContainsErrorStatus,
            // ContainsOKStatus: aggregatedData.ContainsOKStatus,
            // Models: aggregatedData.Models,
            // TopicId: aggregatedData.TopicId,
            // SubTopicId: aggregatedData.SubTopicId,
            // TotalPromptTokenCount: aggregatedData.TotalPromptTokenCount,
            // TotalCompletionTokenCount: aggregatedData.TotalCompletionTokenCount,
            // HasAnnotation: aggregatedData.HasAnnotation,
            // CreatedAt: createdAt ?? lastUpdatedAt,
            // LastUpdatedAt: lastUpdatedAt,
            // ThreadId: aggregatedData.ThreadId,
            // UserId: aggregatedData.UserId,
            // CustomerId: aggregatedData.CustomerId,
            // Labels: aggregatedData.Labels,
            // PromptIds: aggregatedData.PromptIds,
            // PromptVersionIds: aggregatedData.PromptVersionIds,
            // Attributes: aggregatedData.Attributes,
            // TotalCost: aggregatedData.TotalCost,
            // TokensEstimated: aggregatedData.TokensEstimated,
            // ErrorMessage: aggregatedData.ErrorMessage,
          },
        } satisfies TraceSummary;
      }
    );
  }
}
