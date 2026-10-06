export type { TraceProcessingCommands } from "./services/trace-processing-commands.service.ts";
export type {
  TraceSpanContentDrop,
  TraceSpanContentDropResult,
  TraceSpanCostEnrichment,
  TraceSpanPiiRedaction,
  TraceSpanSpool,
  TraceSpanTokenEstimation,
} from "./eventing/record-span.commands.ts";
export type { TraceSummarySubscriber } from "./eventing/origin-guarded.subscriber.ts";
export type { TraceClickHouseClient } from "./repositories/clickhouse/clickhouse.trace-member-client.repository.ts";
export { EventingRecordSpanAdapter } from "./eventing/record-span.commands.ts";
export { traceProcessModule } from "./trace.module.ts";

export {
  EventingTracePipelineAdapter,
  type EventingTracePipelineAdapterOptions,
} from "./eventing/trace-processing-projections.pipeline.ts";
export type { TraceProjectMetadata } from "./eventing/project-metadata.subscriber.ts";
export type { TraceModelCostCatalog } from "./services/span-cost-enrichment.service.ts";
export type {
  TraceEvaluationDispatch,
  TraceEvaluationMonitor,
} from "./eventing/evaluation-trigger.subscriber.ts";
export type {
  TraceEvaluationLoopBlockReason,
  TraceEvaluationLoopMetrics,
} from "./services/trace-evaluation-loop-metrics.service.ts";
export {
  CUSTOM_EVAL_SYNC_DEDUP_TTL_MS,
  CUSTOM_EVAL_SYNC_DELAY_MS,
  createCustomEvaluationSyncHandler,
} from "./eventing/custom-evaluation-sync.subscriber.ts";
export {
  EXPERIMENT_METRICS_SYNC_DEDUP_TTL_MS,
  EXPERIMENT_METRICS_SYNC_DELAY_MS,
  createExperimentMetricsSyncHandler,
  hasExperimentCostMetrics,
} from "./eventing/experiment-metrics-sync.subscriber.ts";
export {
  PROJECT_METADATA_WINDOW_MS,
  createProjectMetadataHandler,
} from "./eventing/project-metadata.subscriber.ts";
export {
  SPAN_STORAGE_BROADCAST_DEDUP_TTL_MS,
  createSpanStorageBroadcastHandler,
} from "./eventing/span-storage-broadcast.subscriber.ts";
export {
  TRACE_UPDATE_BROADCAST_WINDOW_MS,
  createTraceUpdateBroadcastHandler,
} from "./eventing/trace-update-broadcast.subscriber.ts";
export {
  TRACKED_EVENT_SYNC_DEDUP_TTL_MS,
  TRACKED_EVENT_SYNC_DELAY_MS,
  createTrackedEventSyncHandler,
} from "./eventing/tracked-event-sync.subscriber.ts";
export type {
  TraceClickHouseResolver,
  TraceClickHouseWriteResolver,
} from "./repositories/clickhouse/clickhouse.trace-member-client.repository.ts";
export type { SpanDedupClaim, SpanDedupRef } from "./repositories/trace-span-dedup.repository.ts";
export { type TraceAnalyticsData } from "./eventing/trace-derived.projection.ts";
export { SpanStorageStore } from "./eventing/span-storage.store.ts";
export { TraceAnalyticsStore } from "./eventing/trace-derived.store.ts";
export { TraceAnalyticsRollupStore } from "./eventing/trace-rollup.store.ts";
export { TraceSummaryStore } from "./eventing/trace-summary.store.ts";
export { createEvaluationTriggerSubscriber } from "./eventing/evaluation-trigger.subscriber.ts";
