import {
  type AppendStore,
  defineAggregate,
  defineEvents,
  definePipeline,
  type FoldProjectionStore,
} from "@langwatch/eventing";
import {
  type NormalizedSpan,
  type TraceProcessingEvent,
  TRACE_PROCESSING_EVENT_TYPES,
  type TraceSummaryData,
  RECORD_SPAN_COALESCE_MAX_BATCH,
  TRACE_CORRELATION_COALESCE_MAX_BATCH,
  type RecordSpanCommandData,
} from "@langwatch/trace-contract";
import type { TraceCanonicalisationService } from "@langwatch/trace-contract";
import { TraceIoExtractionPort } from "../ports/trace-io-extraction.port";
import { TraceMediaReferencePort } from "../ports/trace-media-reference.port";
import { TraceModelCostPort } from "../ports/trace-model-cost.port";
import { TraceSpanNormalizationPort } from "../ports/trace-span-normalization.port";
import {
  type TraceAnalyticsData,
  TraceAnalyticsFoldProjection,
} from "../projections/trace-derived.projection";
import {
  type TraceAnalyticsRollupRow,
  TraceAnalyticsRollupMapProjection,
} from "../projections/trace-rollup.projection";
import { SpanStorageMapProjection } from "../projections/span-storage.projection";
import { TraceSummaryFoldProjection } from "../projections/trace-summary.projection";
import { TraceProjectionRuntimeService } from "../services/trace-projection-runtime.service";
import {
  EventingRecordSpanAdapter,
  RECORD_SPAN_DEDUPLICATION,
} from "./eventing.record-span.adapter";
import { EventingTraceOriginAdapter } from "./eventing.trace-origin.adapter";
import { EventingTraceProcessingAdapter } from "./eventing.trace-processing.adapter";
import { EventingTraceTopicAdapter } from "./eventing.trace-topic.adapter";
import {
  clampSpanShardCount,
  spanCommandGroupKey,
} from "../services/trace-span-command-shard.rules";

export type EventingTracePipelineAdapterOptions = {
  spanStore: AppendStore<NormalizedSpan>;
  summaryStore: FoldProjectionStore<TraceSummaryData>;
  derivedStore: FoldProjectionStore<TraceAnalyticsData>;
  rollupStore: AppendStore<TraceAnalyticsRollupRow>;
  canonicalisation: TraceCanonicalisationService;
  ioExtraction: TraceIoExtractionPort;
  mediaReferences: TraceMediaReferencePort;
  modelCosts: TraceModelCostPort;
  spanNormalization: TraceSpanNormalizationPort;
  prepareEventForProjection: (event: TraceProcessingEvent) => TraceProcessingEvent;
  recordSpanCommand: EventingRecordSpanAdapter;
  spanCommandShardCount?: number;
};

function buildTracePipeline(options: EventingTracePipelineAdapterOptions) {
  const runtime = TraceProjectionRuntimeService.create({
    canonicalisation: options.canonicalisation,
    ioExtraction: options.ioExtraction,
    mediaReferences: options.mediaReferences,
    modelCosts: options.modelCosts,
    spanNormalization: options.spanNormalization,
  });

  const spanCommandShardCount = clampSpanShardCount(options.spanCommandShardCount ?? 1);
  const recordSpanOptions: {
    deduplication: typeof RECORD_SPAN_DEDUPLICATION;
    getGroupKey?: (payload: RecordSpanCommandData) => string;
    coalesceMaxBatch: (payload: RecordSpanCommandData) => number;
  } = {
    deduplication: RECORD_SPAN_DEDUPLICATION,
    coalesceMaxBatch: (payload) => (payload.spoolRef ? 1 : RECORD_SPAN_COALESCE_MAX_BATCH),
  };
  if (spanCommandShardCount > 1) {
    recordSpanOptions.getGroupKey = (payload) =>
      spanCommandGroupKey({
        traceId: payload.span.traceId,
        spanId: payload.span.spanId,
        shardCount: spanCommandShardCount,
      });
  }

  const commands = EventingTraceProcessingAdapter.create();

  return definePipeline<TraceProcessingEvent>({
    name: "trace_processing",
    aggregate: defineAggregate({
      type: "trace",
      events: defineEvents(TRACE_PROCESSING_EVENT_TYPES),
    }),
  })
    .withProjectionPayloadPreparation(options.prepareEventForProjection)
    .withClickHouseFoldProjection(
      TraceSummaryFoldProjection.create({
        store: options.summaryStore,
        traceCanonicalisation: options.canonicalisation,
        runtime,
      }),
    )
    .withClickHouseFoldProjection(
      TraceAnalyticsFoldProjection.create({
        store: options.derivedStore,
        traceCanonicalisation: options.canonicalisation,
        runtime,
      }),
    )
    .withClickHouseMapProjection(
      SpanStorageMapProjection.create({
        store: options.spanStore,
        spanCostService: runtime.spanCost,
        spanNormalization: runtime.spanNormalization,
      }),
    )
    .withClickHouseMapProjection(
      TraceAnalyticsRollupMapProjection.create({
        store: options.rollupStore,
        spanCostService: runtime.spanCost,
        spanNormalization: runtime.spanNormalization,
      }),
    )
    .withCommandInstance(
      "recordSpan",
      EventingRecordSpanAdapter,
      options.recordSpanCommand,
      recordSpanOptions,
    )
    .withCommand("assignTopic", EventingTraceTopicAdapter)
    .withCommand("recordLogContribution", commands.recordLogContributionCommand, {
      coalesceMaxBatch: TRACE_CORRELATION_COALESCE_MAX_BATCH,
    })
    .withCommand("recordMetricCorrelation", commands.recordMetricCorrelationCommand, {
      coalesceMaxBatch: TRACE_CORRELATION_COALESCE_MAX_BATCH,
    })
    .withCommand("resolveOrigin", EventingTraceOriginAdapter)
    .withCommand("addAnnotation", commands.addAnnotationCommand)
    .withCommand("removeAnnotation", commands.removeAnnotationCommand)
    .withCommand("bulkSyncAnnotations", commands.bulkSyncAnnotationsCommand)
    .withCommand("changeTraceName", commands.changeTraceNameCommand);
}

/** Deliberate process-facing adapter for Trace's deterministic projections. */
export class EventingTracePipelineAdapter {
  private constructor(private readonly options: EventingTracePipelineAdapterOptions) {}

  static create(options: EventingTracePipelineAdapterOptions): EventingTracePipelineAdapter {
    return new EventingTracePipelineAdapter(options);
  }

  build() {
    return buildTracePipeline(this.options);
  }
}
