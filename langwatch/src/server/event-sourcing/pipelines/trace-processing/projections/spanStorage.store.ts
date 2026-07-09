import type { SpanStorageRepository } from "~/server/app-layer/traces/repositories/span-storage.repository";
import type { SpanInsertData } from "~/server/app-layer/traces/types";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { AppendStore } from "../../../projections/mapProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import type { NormalizedSpan } from "../schemas/spans";

/**
 * Maps a pipeline NormalizedSpan to the app-layer SpanInsertData.
 */
function toAppLayer(
  span: NormalizedSpan,
  retentionDays: number,
): SpanInsertData {
  return {
    id: span.id,
    tenantId: span.tenantId,
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    parentTraceId: span.parentTraceId,
    parentIsRemote: span.parentIsRemote,
    sampled: span.sampled,
    startTimeUnixMs: span.startTimeUnixMs,
    endTimeUnixMs: span.endTimeUnixMs,
    durationMs: span.durationMs,
    name: span.name,
    kind: span.kind as number,
    resourceAttributes: span.resourceAttributes as Record<string, unknown>,
    spanAttributes: span.spanAttributes as Record<string, unknown>,
    statusCode: span.statusCode as number | null,
    statusMessage: span.statusMessage,
    instrumentationScope: {
      name: span.instrumentationScope.name,
      version: span.instrumentationScope.version ?? undefined,
    },
    events: span.events.map((e) => ({
      name: e.name,
      timeUnixMs: e.timeUnixMs,
      attributes: e.attributes as Record<string, unknown>,
    })),
    links: span.links.map((l) => ({
      traceId: l.traceId,
      spanId: l.spanId,
      attributes: l.attributes as Record<string, unknown>,
    })),
    droppedAttributesCount: span.droppedAttributesCount,
    droppedEventsCount: span.droppedEventsCount,
    droppedLinksCount: span.droppedLinksCount,
    cost: span.cost,
    nonBilledCost: span.nonBilledCost,
    retentionDays,
  };
}

/**
 * Thin AppendStore adapter for span storage.
 * Converts pipeline NormalizedSpan → app-layer SpanInsertData and delegates to SpanStorageRepository.
 *
 * Content dropping is applied earlier, in RecordSpanCommand (see
 * applyOtlpSpanContentDrop), so it also covers the trace-summary fold that
 * derives ComputedInput/Output from the same event. The store just persists.
 */
export class SpanAppendStore implements AppendStore<NormalizedSpan> {
  constructor(private readonly repo: SpanStorageRepository) {}

  async append(
    record: NormalizedSpan,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const retentionDays =
      context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS;
    await this.repo.insertSpan(toAppLayer(record, retentionDays));
  }

  async bulkAppend(
    records: NormalizedSpan[],
    context: ProjectionStoreContext,
  ): Promise<void> {
    if (records.length === 0) return;
    const retentionDays =
      context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS;
    await this.repo.insertSpans(
      records.map((r) => toAppLayer(r, retentionDays)),
    );
  }
}
