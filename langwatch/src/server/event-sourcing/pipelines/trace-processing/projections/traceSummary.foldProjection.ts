import type { Projection } from "../../../library";
import type { FoldProjectionDefinition } from "../../../library/projections/foldProjection.types";
import { TRACE_PROCESSING_EVENT_TYPES } from "../schemas/constants";
import type {
  SpanReceivedEvent,
  TraceProcessingEvent,
} from "../schemas/events";
import { isSpanReceivedEvent, isTopicAssignedEvent } from "../schemas/events";
import type { NormalizedSpan } from "../schemas/spans";
import { SpanNormalizationPipelineService } from "../services";
import { traceSummaryFoldStore } from "../repositories/traceSummaryFoldStore";

/**
 * Summary data for trace metrics.
 * Matches the trace_summaries ClickHouse table schema exactly.
 */
export interface TraceSummaryData {
  TraceId: string;
  SpanCount: number;
  TotalDurationMs: number;
  ComputedIOSchemaVersion: string;
  ComputedInput: string | null;
  ComputedOutput: string | null;
  TimeToFirstTokenMs: number | null;
  TimeToLastTokenMs: number | null;
  TokensPerSecond: number | null;
  ContainsErrorStatus: boolean;
  ContainsOKStatus: boolean;
  ErrorMessage: string | null;
  Models: string[];
  TotalCost: number | null;
  TokensEstimated: boolean;
  TotalPromptTokenCount: number | null;
  TotalCompletionTokenCount: number | null;
  TopicId: string | null;
  SubTopicId: string | null;
  HasAnnotation: boolean | null;
  Attributes: Record<string, string>;
  OccurredAt: number;
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
 * Intermediate fold state for computing trace summaries from events.
 *
 * Accumulates normalized spans and topic assignments as events are applied.
 * The store aggregates all normalized spans into a TraceSummary when persisting.
 */
export interface TraceSummaryFoldState {
  /** Normalized spans accumulated from SpanReceivedEvents. */
  normalizedSpans: NormalizedSpan[];

  /** Timestamp of the first span event, used for CreatedAt. */
  createdAt: number | null;

  /** Timestamp of the most recent event, used for LastUpdatedAt. */
  lastUpdatedAt: number;

  /** The first SpanReceivedEvent, used for deterministic ID generation. */
  firstSpanEvent: SpanReceivedEvent | null;

  /** Assigned topic ID from TopicAssignedEvent. */
  topicId: string | null;

  /** Assigned subtopic ID from TopicAssignedEvent. */
  subtopicId: string | null;
}

const spanNormalizationPipelineService = new SpanNormalizationPipelineService();

/**
 * FoldProjection definition for trace summaries.
 *
 * Extracts the event processing logic from TraceSummaryProjectionHandler
 * into a pure functional fold. SpanReceivedEvents are normalized and accumulated;
 * TopicAssignedEvents update topic metadata. The store handles aggregation
 * and persistence.
 */
export const traceSummaryFoldProjection: FoldProjectionDefinition<
  TraceSummaryFoldState,
  TraceProcessingEvent
> = {
  name: "traceSummary",
  eventTypes: TRACE_PROCESSING_EVENT_TYPES,

  init(): TraceSummaryFoldState {
    return {
      normalizedSpans: [],
      createdAt: null,
      lastUpdatedAt: Date.now(),
      firstSpanEvent: null,
      topicId: null,
      subtopicId: null,
    };
  },

  apply(
    state: TraceSummaryFoldState,
    event: TraceProcessingEvent,
  ): TraceSummaryFoldState {
    if (isSpanReceivedEvent(event)) {
      const normalizedSpan =
        spanNormalizationPipelineService.normalizeSpanReceived(
          event.tenantId,
          event.data.span,
          event.data.resource,
          event.data.instrumentationScope,
        );

      return {
        ...state,
        normalizedSpans: [...state.normalizedSpans, normalizedSpan],
        createdAt: state.createdAt ?? event.timestamp,
        lastUpdatedAt: event.timestamp,
        firstSpanEvent: state.firstSpanEvent ?? event,
      };
    }

    if (isTopicAssignedEvent(event)) {
      return {
        ...state,
        // Only override if new value is non-null (prevent null override)
        topicId: event.data.topicId ?? state.topicId,
        subtopicId: event.data.subtopicId ?? state.subtopicId,
        lastUpdatedAt: event.timestamp,
      };
    }

    return state;
  },

  store: traceSummaryFoldStore,
};
