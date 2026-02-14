import type { FoldProjectionStore } from "../../../library/projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../library/projections/projectionStoreContext";
import type { TraceSummaryFoldState } from "../projections/traceSummary.foldProjection";
import type { TraceSummary } from "../projections/traceSummary.foldProjection";
import { TRACE_SUMMARY_PROJECTION_VERSION_LATEST } from "../schemas/constants";
import { traceAggregationService } from "../services/traceAggregationService";
import { IdUtils } from "../utils/id.utils";
import { traceSummaryRepository } from "./index";

/**
 * FoldProjectionStore wrapper for trace summaries.
 *
 * Adapts the existing TraceSummaryRepository to the FoldProjectionStore interface.
 * The store method aggregates all normalized spans from the fold state into a
 * TraceSummary projection using the TraceAggregationService before persisting.
 */
export const traceSummaryFoldStore: FoldProjectionStore<TraceSummaryFoldState> = {
  async store(
    state: TraceSummaryFoldState,
    context: ProjectionStoreContext,
  ): Promise<void> {
    // If no spans were collected, skip storing
    if (!state.firstSpanEvent || state.normalizedSpans.length === 0) {
      return;
    }

    const aggregatedData = traceAggregationService.aggregateTrace(
      state.normalizedSpans,
    );

    const traceSummaryId =
      IdUtils.generateDeterministicTraceSummaryId(state.firstSpanEvent);

    const projection: TraceSummary = {
      id: traceSummaryId,
      aggregateId: context.aggregateId,
      tenantId: context.tenantId,
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
        TopicId: state.topicId,
        SubTopicId: state.subtopicId,
        HasAnnotation: null,
        Attributes: aggregatedData.attributes,
        OccurredAt: aggregatedData.startTimeUnixMs,
        CreatedAt: state.createdAt ?? state.lastUpdatedAt,
        LastUpdatedAt: state.lastUpdatedAt,
      },
    };

    await traceSummaryRepository.storeProjection(projection, {
      tenantId: context.tenantId,
    });
  },

  async get(
    _aggregateId: string,
    _context: ProjectionStoreContext,
  ): Promise<TraceSummaryFoldState | null> {
    // Fold projections using rebuild strategy always replay all events.
    // The fold state includes intermediate data (normalizedSpans, firstSpanEvent)
    // that cannot be reconstructed from the stored projection, so we return null
    // to force a full rebuild from events.
    return null;
  },
};
