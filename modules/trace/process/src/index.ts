export { TraceCanonicalisationService } from "./services/trace-canonicalisation.service.ts";
export type {
  TraceProcessingCommands,
  TraceProductAnalytics,
  TraceProductEvent,
  TraceSpanContentDrop,
  TraceSpanContentDropResult,
  TraceSpanCostEnrichment,
  TraceSpanPiiRedaction,
  TraceSpanSpool,
  TraceTenantBroadcast,
} from "./app/trace.members.ts";
export {
  passesTraceOriginGuards,
  type TraceSummarySubscriber,
} from "./eventing/origin-guarded.subscriber.ts";
export type { TraceClickHouseClient } from "./repositories/trace-clickhouse-client.repository.ts";
export { ClickHouseTraceQueryRepository } from "./repositories/clickhouse/clickhouse.trace-query.repository.ts";
export { ClickhouseTraceQueryEvaluationRepository } from "./repositories/clickhouse/clickhouse.trace-query-evaluation.repository.ts";
export { EventingRecordSpanAdapter } from "./services/eventing.record-span.service.ts";
export { TraceListService } from "./services/trace-list-read.service.ts";
export { TraceBlobStoreService } from "./services/trace-blob-store.service.ts";
export { traceServer, type TraceInfrastructure } from "./trace.server.ts";

// Restored: these names have consumers outside this module.
export { traceRepositories } from "./repositories/trace-repositories.registry.ts";
export {
  EventingTracePipelineAdapter,
  type EventingTracePipelineAdapterOptions,
} from "./services/eventing.trace-pipeline.service.ts";
export type {
  TraceSpanTokenEstimation,
  TraceSpoolLegacyObject,
  TraceSpoolStorage,
  TraceSpoolObjectStore,
  TraceProjectMetadata,
  TraceModelCostCatalog,
  TraceEvaluationMonitor,
  TraceEvaluationLoopMetrics,
  TraceEvaluationLoopBlockReason,
  TraceEvaluationDispatch,
} from "./app/trace.members.ts";
export { TraceDeferredOriginEventingAdapter } from "./services/eventing.deferred-origin.service.ts";
export {
  CUSTOM_EVAL_SYNC_DEDUP_TTL_MS,
  CUSTOM_EVAL_SYNC_DELAY_MS,
  CustomEvaluationSync,
} from "./eventing/custom-evaluation-sync.subscriber.ts";
export {
  EXPERIMENT_METRICS_SYNC_DEDUP_TTL_MS,
  EXPERIMENT_METRICS_SYNC_DELAY_MS,
  createExperimentMetricsSyncHandler,
  hasExperimentCostMetrics,
} from "./eventing/experiment-metrics-sync.subscriber.ts";
export {
  PROJECT_METADATA_WINDOW_MS,
  ProjectMetadataSync,
} from "./eventing/project-metadata.subscriber.ts";
export {
  CIO_TRACE_SYNC_DEBOUNCE_MS,
  createCustomerIoTraceSyncHandler,
  customerIoTraceSyncJobId,
  resetCustomerIoTraceSyncDebounceCache,
} from "./eventing/customer-io-trace-sync.subscriber.ts";
export type {
  CustomerIoTraceSyncDeps,
  CustomerIoTraceSyncSubscriberDeps,
} from "./eventing/customer-io-trace-sync.subscriber.ts";
export {
  SIMULATION_METRICS_SYNC_DEDUP_TTL_MS,
  SIMULATION_METRICS_SYNC_DELAY_MS,
  createSimulationMetricsSyncHandler,
  hasSimulationMetrics,
} from "./eventing/simulation-metrics-sync.subscriber.ts";
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
  TrackedEventSync,
} from "./eventing/tracked-event-sync.subscriber.ts";
export type {
  TraceClickHouseResolver,
  TraceClickHouseWriteResolver,
} from "./repositories/trace-clickhouse-client.repository.ts";
export { TracePayloadReaderRepository } from "./repositories/trace-payload-reader.repository.ts";
export { TraceQueryClassificationService } from "./services/trace-query-classification.service.ts";
export { TraceSpanStorageRepository } from "./repositories/span-storage-write.repository.ts";
export {
  TraceSpanStorageClickHouseRepository,
  TraceStoredSpanReaderClickHouseRepository,
} from "./repositories/clickhouse/trace-span-storage.repository.ts";
export { TraceStoredSpanReaderRepository } from "./repositories/trace-stored-span-reader.repository.ts";
export { TraceDerivationSpanClickHouseRepository } from "./repositories/clickhouse/trace-derivation-span.repository.ts";
export { TraceEventDerivationService } from "./services/trace-event-derivation.service.ts";
export { ScenarioRoleMetricsDerivationService } from "./services/scenario-role-metrics-derivation.service.ts";
export {
  TraceSpanCollectionService,
  TraceIngressCommand,
} from "./services/trace-ingestion.service.ts";
export {
  TraceSpanDedupRepository,
  type SpanDedupClaim,
  type SpanDedupRef,
} from "./repositories/trace-span-dedup.repository.ts";
export { TrackedEventSpanService } from "./services/tracked-event-span.service.ts";
export { TraceSummaryProjectionClickHouseRepository } from "./repositories/clickhouse/trace-summary.repository.ts";
export { TraceAnalyticsClickHouseRepository } from "./repositories/clickhouse/trace-metrics-analytics.repository.ts";
export { TraceAnalyticsRollupClickHouseRepository } from "./repositories/clickhouse/trace-analytics-rollup.repository.ts";
export { type TraceAnalyticsData } from "./eventing/trace-derived.projection.ts";
export { SpanStorageStore } from "./eventing/span-storage.store.ts";
export { TraceAnalyticsStore } from "./eventing/trace-derived.store.ts";
export { TraceAnalyticsRollupStore } from "./eventing/trace-rollup.store.ts";
export { TraceSummaryStore } from "./eventing/trace-summary.store.ts";
export { SpanCostService } from "./services/span-cost.service.ts";
export { resolveSpanCommandShardCount } from "./rules/trace-span-command-shard.rules.ts";
export { TraceProjectionLeanService } from "./services/projection/trace-projection-lean.service.ts";
export { TraceIoExtractionAdapter } from "./services/trace-io-extraction-adapter.service.ts";
export { TraceSpanNormalizationAdapter } from "./services/trace-span-normalization-adapter.service.ts";
export { TraceMediaReferenceAdapter } from "./services/trace-media-reference.service.ts";
export { ModelCatalogTraceModelCostAdapter } from "./services/model-catalog.trace-model-cost.service.ts";
export { SpanNormalizationPipelineService } from "./services/span-normalization.service.ts";
export { TraceSpoolService } from "./services/trace-spool.service.ts";
export { OtelTraceEvaluationLoopMetricsAdapter } from "./services/otel.trace-evaluation-loop-metrics.service.ts";
export { createEvaluationTriggerSubscriber } from "./eventing/evaluation-trigger.subscriber.ts";
export type { TraceLegacyReadRepository } from "./repositories/trace-legacy-read.repository.ts";
export { VisibilityWindowService } from "./services/trace-visibility-window.service.ts";
export { createTracePayloadReader, createTraceLegacyRead } from "./trace.server.ts";
