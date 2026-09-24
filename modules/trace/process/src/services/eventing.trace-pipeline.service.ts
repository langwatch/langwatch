import {
  type AppendStore,
  defineAggregate,
  definePipeline,
  type FoldProjectionStore,
} from "@langwatch/eventing";
import {
  type NormalizedSpan,
  type TraceProcessingEvent,
  type TraceSummaryData,
  RECORD_SPAN_COALESCE_MAX_BATCH,
  TRACE_CORRELATION_COALESCE_MAX_BATCH,
  type RecordSpanCommandData,
  type TraceCanonicalisationService,
  spanReceivedEventSchema,
  spanRecordedEventSchema,
  topicAssignedEventSchema,
  logRecordReceivedEventSchema,
  logContributedEventSchema,
  metricDataPointCorrelatedEventSchema,
  originResolvedEventSchema,
  annotationAddedEventSchema,
  annotationRemovedEventSchema,
  annotationsBulkSyncedEventSchema,
  traceNameChangedEventSchema,
} from "@langwatch/trace-contract";

import {
  type TraceIoExtraction,
  type TraceMediaReferenceResolver,
  type TraceModelCost,
  type TraceSpanNormalization,
} from "../app/trace.members.ts";
import { SpanStorageMapProjection } from "../eventing/span-storage.projection.ts";
import {
  type TraceAnalyticsData,
  TraceAnalyticsFoldProjection,
} from "../eventing/trace-derived.projection.ts";
import {
  type TraceAnalyticsRollupRow,
  TraceAnalyticsRollupMapProjection,
} from "../eventing/trace-rollup.projection.ts";
import { TraceSummaryFoldProjection } from "../eventing/trace-summary.projection.ts";
import {
  clampSpanShardCount,
  spanCommandGroupKey,
} from "../rules/trace-span-command-shard.rules.ts";
import {
  EventingRecordSpanAdapter,
  RECORD_SPAN_DEDUPLICATION,
} from "./eventing.record-span.service.ts";
import { EventingTraceOriginAdapter } from "./eventing.trace-origin.service.ts";
import { EventingTraceProcessingAdapter } from "./eventing.trace-processing.service.ts";
import { EventingTraceTopicAdapter } from "./eventing.trace-topic-assignment.service.ts";
import { TraceProjectionRuntimeService } from "./projection/trace-projection-runtime.service.ts";

/** Trace pipeline name; shared by both full and producer-only registration shapes. */
export const TRACE_PROCESSING_PIPELINE_NAME = "trace_processing";

export type EventingTracePipelineAdapterOptions = {
  spanStore: AppendStore<NormalizedSpan>;
  summaryStore: FoldProjectionStore<TraceSummaryData>;
  derivedStore: FoldProjectionStore<TraceAnalyticsData>;
  rollupStore: AppendStore<TraceAnalyticsRollupRow>;
  canonicalisation: TraceCanonicalisationService;
  ioExtraction: TraceIoExtraction;
  mediaReferences: TraceMediaReferenceResolver;
  modelCosts: TraceModelCost;
  spanNormalization: TraceSpanNormalization;
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
    name: TRACE_PROCESSING_PIPELINE_NAME,
    aggregate: defineAggregate({
      type: "trace",
    }),
  })
    .withEvents([
      spanReceivedEventSchema,
      spanRecordedEventSchema,
      topicAssignedEventSchema,
      logRecordReceivedEventSchema,
      logContributedEventSchema,
      metricDataPointCorrelatedEventSchema,
      originResolvedEventSchema,
      annotationAddedEventSchema,
      annotationRemovedEventSchema,
      annotationsBulkSyncedEventSchema,
      traceNameChangedEventSchema,
    ])
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

  build(): ReturnType<typeof buildTracePipeline> {
    return buildTracePipeline(this.options);
  }
}
