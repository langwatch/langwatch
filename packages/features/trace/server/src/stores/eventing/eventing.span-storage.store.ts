import type { AppendStore, BulkAppendContext, ProjectionStoreContext } from "@langwatch/eventing";
import type { SpanInsertData } from "@langwatch/trace-contract";
import type { NormalizedSpan } from "@langwatch/trace-contract";
import { TraceSpanStoragePort } from "../../ports/trace-span-storage.port";

/**
 * Maps a pipeline NormalizedSpan to the app-layer SpanInsertData.
 */
function toAppLayer(span: NormalizedSpan, retentionDays: number): SpanInsertData {
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
export class SpanStorageStore implements AppendStore<NormalizedSpan> {
  private constructor(
    private readonly storage: TraceSpanStoragePort,
    private readonly defaultRetentionDays: number,
  ) {}

  static create(options: {
    storage: TraceSpanStoragePort;
    defaultRetentionDays: number;
  }): SpanStorageStore {
    return new SpanStorageStore(options.storage, options.defaultRetentionDays);
  }

  async append(record: NormalizedSpan, context: ProjectionStoreContext): Promise<void> {
    const retentionDays = context.retentionPolicy?.traces ?? this.defaultRetentionDays;
    await this.storage.insertSpan(toAppLayer(record, retentionDays));
  }

  async bulkAppend(records: NormalizedSpan[], context: BulkAppendContext): Promise<void> {
    if (records.length === 0) return;
    const retentionDays = context.retentionPolicy?.traces ?? this.defaultRetentionDays;
    await this.storage.insertSpans(records.map((record) => toAppLayer(record, retentionDays)));
  }
}
