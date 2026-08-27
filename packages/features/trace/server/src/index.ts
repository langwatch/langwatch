export {
  ClickHouseTraceAdapter,
  type ClickHouseTraceAdapterOptions,
} from "./adapters/clickhouse-trace.adapter";
export { TraceCanonicalisationService } from "./services/trace-canonicalisation.service";
export { NullTraceListAdapter } from "./adapters/null-trace-list.adapter";
export {
  EventingTracePipelineAdapter,
  type EventingTracePipelineAdapterOptions,
} from "./adapters/eventing.trace-pipeline.adapter";
export { EventingTraceProcessingAdapter } from "./adapters/eventing.trace-processing.adapter";
export { TraceListClickHouseRepository } from "./repositories/clickhouse/trace-list.repository";
export type { TraceClickHouseClient, TraceClickHouseResolver } from "./ports/clickhouse.port";
export { TraceRecordPort } from "./ports/trace-record.port";
export { TraceEventDerivationPort } from "./ports/trace-event-derivation.port";
export { TraceQueryFieldValuesPort } from "./ports/query-field-values.port";
export { TraceQueryClassificationPort } from "./ports/trace-query-classification.port";
export { TraceSummaryReaderPort } from "./ports/trace-summary-reader.port";
export {
  TraceSummaryProjectionPort,
  type TraceSummaryProjectionEntry,
  type TraceSummaryReadWindow,
} from "./ports/trace-summary-projection.port";
export {
  TraceSpanContentDropPort,
  TraceSpanCostEnrichmentPort,
  TraceSpanPiiRedactionPort,
  TraceSpanTokenEstimationPort,
  type TraceSpanContentDropResult,
} from "./ports/trace-span-preparation.port";
export { TraceSpanSpoolPort, type TraceSpanSpoolIdentity } from "./ports/trace-span-spool.port";
export { TraceSpanNormalizationPort } from "./ports/trace-span-normalization.port";
export { TraceSpanStoragePort } from "./ports/trace-span-storage.port";
export {
  TraceAnalyticsProjectionPort,
  type TraceAnalyticsProjectionEntry,
  type TraceAnalyticsProjectionRead,
} from "./ports/trace-analytics-projection.port";
export { TraceAnalyticsRollupPort } from "./ports/trace-analytics-rollup.port";
export {
  RECORD_SPAN_DEDUPLICATION,
  EventingRecordSpanAdapter as RecordSpanCommand,
  type RecordSpanCommandOptions,
} from "./adapters/eventing.record-span.adapter";
export { EventingTraceTopicAdapter as AssignTopicCommand } from "./adapters/eventing.trace-topic.adapter";
export { EventingTraceOriginAdapter as ResolveOriginCommand } from "./adapters/eventing.trace-origin.adapter";
export { EventingTraceLogContributionAdapter as RecordLogContributionCommand } from "./adapters/eventing.trace-log-contribution.adapter";
export { EventingTraceMetricCorrelationAdapter as RecordMetricCorrelationCommand } from "./adapters/eventing.trace-metric-correlation.adapter";
export type {
  TraceQueryFieldValuesInput,
  TraceQueryFieldValuesResult,
} from "./ports/query-field-values.port";
export { SpanStorageMapProjection } from "./projections/span-storage.projection";
export {
  applySpanToSummary,
  MAX_PROCESSED_SPANS,
  mergeModelsMostRecentFirst,
  RESERVED_CACHE_CREATION_TOKENS,
  RESERVED_CACHE_READ_TOKENS,
  RESERVED_REASONING_TOKENS,
  TRACE_SUMMARY_READ_WINDOW_MS,
  TraceSummaryFoldProjection,
} from "./projections/trace-summary.projection";
export {
  applySpanToAnalytics,
  projectAnalyticsStateToRow,
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT,
  type TraceAnalyticsData,
  TraceAnalyticsFoldProjection,
  type TraceAnalyticsRow,
  traceAnalyticsStateFromRow,
} from "./projections/trace-derived.projection";
export {
  TraceAnalyticsRollupMapProjection,
  type TraceAnalyticsRollupRow,
} from "./projections/trace-rollup.projection";
export { SpanStorageStore } from "./stores/eventing/eventing.span-storage.store";
export { TraceAnalyticsStore } from "./stores/eventing/eventing.trace-derived.store";
export { TraceAnalyticsRollupStore } from "./stores/eventing/eventing.trace-rollup.store";
export { TraceSummaryStore } from "./stores/eventing/eventing.trace-summary.store";
export { SpanCostService } from "./services/span-cost.service";
export {
  TraceIngestionService,
  TraceIngressCommandPort,
  TraceIngressPayloadPort,
  TraceSpanDedupPort,
  type SpanIngestionResult,
  type SpanIngestionStatus,
  type TraceRequestCollectionResult,
} from "./services/trace-ingestion.service";
export {
  DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES,
  capOversizedAttributes,
  hasOversizedAttribute,
} from "./services/trace-attribute-cap.rules";
export { capPayloadString } from "./services/trace-payload-cap.rules";
export {
  clampSpanShardCount,
  MAX_SPAN_SHARD_COUNT,
  resolveSpanCommandShardCount,
  spanCommandGroupKey,
} from "./services/trace-span-command-shard.rules";
export { firstUsableAnchor } from "./services/trace-storage-anchor.rules";
export { anchorStorageTime } from "./services/trace-storage-anchor.rules";
export {
  SPAN_STORAGE_MAP_SHARD_COUNT,
  spanStorageMapGroupKey,
  TRACE_SPAN_MAP_COALESCE_MAX_BATCH,
} from "./services/trace-span-storage-group.rules";
export { trimAttributesForAnalytics } from "./services/analytics-attribute-trim.rules";
export { TraceAttributeAccumulationService } from "./services/trace-attribute-accumulation.service";
export { TraceOriginService } from "./services/trace-origin.service";
export {
  extractIOFromLogRecord,
  OUTPUT_SOURCE,
  shouldOverrideOutput,
  TraceIOAccumulationService,
} from "./services/trace-io-accumulation.service";
export { SpanStatusService } from "./services/span-status.service";
export { SpanTimingService } from "./services/span-timing.service";
export { TraceNameResolutionService } from "./services/trace-name-resolution.service";
export { TracePromptAccumulationService } from "./services/trace-prompt-accumulation.service";
export { TraceProjectionRuntimeService } from "./services/trace-projection-runtime.service";
export {
  aggregateScenarioRoleMetrics,
  deriveScenarioRoleMetricsFromSpans,
  type ScenarioRoleMetrics,
  type ScenarioRoleSpanInput,
} from "./services/scenario-role-metrics.rules";
