import type { ProjectionHandler, EventStream } from "../../../library";
import type { Projection } from "../../../library";
import type { TraceAggregationEvent } from "../schemas/events";
import { isTraceAggregationCompletedEvent } from "../schemas/events";
import { traceAggregationStateProjectionRepository } from "../repositories";

/**
 * Projection data for trace metrics.
 * Matches the trace_projections ClickHouse table schema.
 */
export interface TraceProjectionData {
  // Basic trace info
  TraceId: string;
  SpanCount: number;
  TotalDurationMs: number;
  
  // Computed metrics
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
  
  // Metadata timestamps
  CreatedAt: number;
  LastUpdatedAt: number;
}

/**
 * Projection for trace metrics matching the ClickHouse schema.
 */
export interface TraceProjection
  extends Projection<TraceProjectionData> {
  data: TraceProjectionData;
}

/**
 * Projection handler that builds the trace projection from completed events.
 * Populates all computed trace metrics from TraceAggregationCompletedEvent data.
 */
export class TraceAggregationStateProjectionHandler
  implements
    ProjectionHandler<TraceAggregationEvent, TraceProjection>
{
  static readonly store = traceAggregationStateProjectionRepository;

  handle(
    stream: EventStream<
      TraceAggregationEvent["tenantId"],
      TraceAggregationEvent
    >,
  ): TraceProjection {
    const events = stream.getEvents();
    const aggregateId = stream.getAggregateId();
    const tenantId = stream.getTenantId();

    // Find the latest completed event
    let latestCompletedEvent: TraceAggregationEvent | null = null;
    let createdAt: number | null = null;

    for (const event of events) {
      if (isTraceAggregationCompletedEvent(event)) {
        if (!latestCompletedEvent || event.timestamp > latestCompletedEvent.timestamp) {
          latestCompletedEvent = event;
        }
        if (createdAt === null) {
          createdAt = event.timestamp;
        }
      }
    }

    // If no completed event, return empty projection (shouldn't happen in practice)
    if (!latestCompletedEvent || !isTraceAggregationCompletedEvent(latestCompletedEvent)) {
      const now = Date.now();
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

    const event = latestCompletedEvent;
    const version = event.timestamp;
    const lastUpdatedAt = event.timestamp;

    // Populate projection from event data
    return {
      id: `trace:${event.data.traceId}`,
      aggregateId,
      tenantId,
      version,
      data: {
        TraceId: event.data.traceId,
        SpanCount: event.data.totalSpans,
        TotalDurationMs: event.data.durationMs,
        IOSchemaVersion: event.data.IOSchemaVersion,
        ComputedInput: event.data.ComputedInput,
        ComputedOutput: event.data.ComputedOutput,
        ComputedMetadata: event.data.ComputedMetadata,
        TimeToFirstTokenMs: event.data.TimeToFirstTokenMs,
        TimeToLastTokenMs: event.data.TimeToLastTokenMs,
        TokensPerSecond: event.data.TokensPerSecond,
        ContainsErrorStatus: event.data.ContainsErrorStatus,
        ContainsOKStatus: event.data.ContainsOKStatus,
        Models: event.data.Models,
        TopicId: event.data.TopicId,
        SubTopicId: event.data.SubTopicId,
        TotalPromptTokenCount: event.data.TotalPromptTokenCount,
        TotalCompletionTokenCount: event.data.TotalCompletionTokenCount,
        HasAnnotation: event.data.HasAnnotation,
        CreatedAt: createdAt ?? version,
        LastUpdatedAt: lastUpdatedAt,
      },
    };
  }
}
