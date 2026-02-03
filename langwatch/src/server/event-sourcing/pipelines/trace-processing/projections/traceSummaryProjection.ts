import { type Span, SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "../../../../../utils/logger/server";
import type {
  EventStream,
  Projection,
  ProjectionHandler,
  TenantId,
} from "../../../library";
import { traceSummaryRepository } from "../repositories";
import { TRACE_SUMMARY_PROJECTION_VERSION_LATEST } from "../schemas/constants";
import type {
  SpanReceivedEvent,
  TopicAssignedEvent,
  TraceProcessingEvent,
} from "../schemas/events";
import { isSpanReceivedEvent, isTopicAssignedEvent } from "../schemas/events";
import type { NormalizedSpan } from "../schemas/spans";
import {
  type TraceAggregationResult,
  SpanNormalizationPipelineService,
} from "../services";
import { traceAggregationService } from "../services/traceAggregationService";
import { IdUtils } from "../utils/id.utils";

/**
 * Holds extracted data from trace processing events.
 */
interface ExtractedEventData {
  normalizedSpans: NormalizedSpan[];
  timestamps: TimestampData;
  firstSpanEvent: SpanReceivedEvent | null;
  topicAssignment: TopicAssignment;
}

interface TimestampData {
  createdAt: number | null;
  lastUpdatedAt: number;
}

interface TopicAssignment {
  topicId: string | null;
  subtopicId: string | null;
}

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
export class TraceSummaryProjectionHandler implements ProjectionHandler<
  TraceProcessingEvent,
  TraceSummary
> {
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
  ): TraceSummary | null {
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
      (span) => this.processStream(stream, span),
    );
  }

  private processStream(
    stream: EventStream<TraceProcessingEvent["tenantId"], TraceProcessingEvent>,
    span: Span,
  ): TraceSummary | null {
    const aggregateId = stream.getAggregateId();
    const tenantId = stream.getTenantId();

    const extracted = this.extractDataFromEvents(stream.getEvents());
    span.setAttributes({ "span.count": extracted.normalizedSpans.length });

    if (!this.hasSpans(extracted, { tenantId, aggregateId })) {
      return null;
    }

    span.addEvent("aggregate.start");
    const aggregatedData = traceAggregationService.aggregateTrace(
      extracted.normalizedSpans,
    );
    this.setAggregationAttributes(span, aggregatedData);

    const summary = this.buildTraceSummary(
      aggregateId,
      tenantId,
      extracted.firstSpanEvent,
      aggregatedData,
      extracted.topicAssignment,
      extracted.timestamps,
    );

    span.addEvent("projection.build.complete", { "projection.id": summary.id });
    return summary;
  }

  private extractDataFromEvents(
    events: readonly TraceProcessingEvent[],
  ): ExtractedEventData {
    const normalizedSpans: NormalizedSpan[] = [];
    const timestamps: TimestampData = {
      createdAt: null,
      lastUpdatedAt: Date.now(),
    };
    let firstSpanEvent: SpanReceivedEvent | null = null;
    const topicAssignment: TopicAssignment = {
      topicId: null,
      subtopicId: null,
    };

    for (const event of events) {
      if (isSpanReceivedEvent(event)) {
        this.processSpanEvent(event, normalizedSpans, timestamps);
        firstSpanEvent ??= event;
      } else if (isTopicAssignedEvent(event)) {
        this.processTopicEvent(event, topicAssignment, timestamps);
      }
    }

    return { normalizedSpans, timestamps, firstSpanEvent, topicAssignment };
  }

  private processSpanEvent(
    event: SpanReceivedEvent,
    normalizedSpans: NormalizedSpan[],
    timestamps: TimestampData,
  ): void {
    this.logger.debug(
      {
        spanName: event.data.span.name,
        spanId: event.data.span.spanId,
        eventCount: event.data.span.events?.length ?? 0,
      },
      "Processing SpanReceivedEvent",
    );

    normalizedSpans.push(
      this.spanNormalizationPipelineService.normalizeSpanReceived(
        event.tenantId,
        event.data.span,
        event.data.resource,
        event.data.instrumentationScope,
      ),
    );

    timestamps.createdAt ??= event.timestamp;
    timestamps.lastUpdatedAt = event.timestamp;
  }

  private processTopicEvent(
    event: TopicAssignedEvent,
    topicAssignment: TopicAssignment,
    timestamps: TimestampData,
  ): void {
    // Only override if new value is non-null (prevent null override)
    topicAssignment.topicId = event.data.topicId ?? topicAssignment.topicId;
    topicAssignment.subtopicId =
      event.data.subtopicId ?? topicAssignment.subtopicId;
    timestamps.lastUpdatedAt = event.timestamp;

    this.logger.debug(
      {
        topicId: event.data.topicId,
        subtopicId: event.data.subtopicId,
        topicName: event.data.topicName,
      },
      "Processing TopicAssignedEvent",
    );
  }

  private hasSpans(
    extracted: ExtractedEventData,
    context: { tenantId: string; aggregateId: string },
  ): extracted is ExtractedEventData & { firstSpanEvent: SpanReceivedEvent } {
    if (!extracted.firstSpanEvent || extracted.normalizedSpans.length === 0) {
      this.logger.debug(
        context,
        "No spans found for trace, skipping projection",
      );
      return false;
    }
    return true;
  }

  private setAggregationAttributes(
    span: Span,
    aggregatedData: TraceAggregationResult,
  ): void {
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
  }

  private buildTraceSummary(
    aggregateId: string,
    tenantId: TenantId,
    firstSpanEvent: SpanReceivedEvent,
    aggregatedData: TraceAggregationResult,
    topicAssignment: TopicAssignment,
    timestamps: TimestampData,
  ): TraceSummary {
    const traceSummaryId =
      IdUtils.generateDeterministicTraceSummaryId(firstSpanEvent);

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
        TopicId: topicAssignment.topicId,
        SubTopicId: topicAssignment.subtopicId,
        HasAnnotation: null,
        Attributes: aggregatedData.attributes,
        CreatedAt: timestamps.createdAt ?? timestamps.lastUpdatedAt,
        LastUpdatedAt: timestamps.lastUpdatedAt,
      },
    };
  }
}
