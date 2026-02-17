import type { FoldProjectionStore } from "../../../library/projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../library/projections/projectionStoreContext";
import type {
  TraceSummary,
  TraceSummaryData,
} from "../projections/traceSummary.foldProjection";
import { TRACE_SUMMARY_PROJECTION_VERSION_LATEST } from "../schemas/constants";
import { IdUtils } from "../utils/id.utils";
import { traceSummaryRepository } from "./index";

/**
 * Dumb read/write store for trace summaries.
 * No transformation — state IS the data.
 */
export const traceSummaryFoldStore: FoldProjectionStore<TraceSummaryData> = {
  async store(
    state: TraceSummaryData,
    context: ProjectionStoreContext,
  ): Promise<void> {
    // If no spans were collected, skip storing
    if (state.SpanCount === 0) {
      return;
    }

    const projectionId = IdUtils.generateDeterministicTraceSummaryIdFromData(
      String(context.tenantId),
      state.TraceId,
      state.OccurredAt,
    );

    const projection: TraceSummary = {
      id: projectionId,
      aggregateId: context.aggregateId,
      tenantId: context.tenantId,
      version: TRACE_SUMMARY_PROJECTION_VERSION_LATEST,
      data: state,
    };

    await traceSummaryRepository.storeProjection(projection, {
      tenantId: context.tenantId,
    });
  },

  async storeBatch(
    entries: Array<{ state: TraceSummaryData; context: ProjectionStoreContext }>,
  ): Promise<void> {
    const projections: TraceSummary[] = [];

    for (const { state, context } of entries) {
      if (state.SpanCount === 0) continue;

      const projectionId = IdUtils.generateDeterministicTraceSummaryIdFromData(
        String(context.tenantId),
        state.TraceId,
        state.OccurredAt,
      );

      projections.push({
        id: projectionId,
        aggregateId: context.aggregateId,
        tenantId: context.tenantId,
        version: TRACE_SUMMARY_PROJECTION_VERSION_LATEST,
        data: state,
      });
    }

    if (projections.length > 0) {
      await traceSummaryRepository.storeProjectionBatch(projections, {
        tenantId: entries[0]!.context.tenantId,
      });
    }
  },

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<TraceSummaryData | null> {
    const projection = await traceSummaryRepository.getProjection(aggregateId, {
      tenantId: context.tenantId,
    });

    return (projection?.data as TraceSummaryData) ?? null;
  },
};
