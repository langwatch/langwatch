export { ClickHouseTraceAdapter } from "./adapters/clickhouse.trace.adapter";
export { TraceCanonicalisationService } from "./services/trace-canonicalisation.service";
export { NullTraceListAdapter } from "./adapters/null-trace-list.adapter";
export {
  EventingTracePipelineAdapter,
  type EventingTracePipelineAdapterOptions,
} from "./adapters/eventing.trace-pipeline.adapter";

export { TraceProcessingServerInstaller } from "./adapters/eventing.trace-processing.installer";
export { TraceProcessingInstallerPort } from "./ports/trace-processing-installer.port";
export {
  createOriginGateHandler,
  DEFERRED_ORIGIN_CHECK_DELAY_MS,
  needsOriginResolution,
  ORIGIN_GATE_DEDUP_TTL_MS,
  ORIGIN_GATE_DELAY_MS,
  TraceDeferredOriginSchedulerPort,
} from "./adapters/eventing.deferred-origin.adapter";
export { TraceProcessingPipelinePort } from "./ports/trace-processing-pipeline.port";
export {
  defineOriginGuardedTraceSubscriber,
  passesTraceOriginGuards,
  type TraceSummarySubscriber,
} from "./subscribers/origin-guarded.subscriber";
export {
  CUSTOM_EVAL_SYNC_DEDUP_TTL_MS,
  CUSTOM_EVAL_SYNC_DELAY_MS,
  createCustomEvaluationSyncHandler,
  customEvaluationSyncDedupId,
  hasSyncableEvaluations,
} from "./subscribers/custom-evaluation-sync.subscriber";
export {
  EXPERIMENT_METRICS_SYNC_DEDUP_TTL_MS,
  EXPERIMENT_METRICS_SYNC_DELAY_MS,
  createExperimentMetricsSyncHandler,
  hasExperimentCostMetrics,
} from "./subscribers/experiment-metrics-sync.subscriber";
export {
  PROJECT_METADATA_WINDOW_MS,
  createProjectMetadataHandler,
  isRealFirstIngest,
  projectMetadataGroupKey,
} from "./subscribers/project-metadata.subscriber";
export {
  SIMULATION_METRICS_SYNC_DEDUP_TTL_MS,
  SIMULATION_METRICS_SYNC_DELAY_MS,
  createSimulationMetricsSyncHandler,
  hasSimulationMetrics,
} from "./subscribers/simulation-metrics-sync.subscriber";
export {
  SPAN_STORAGE_BROADCAST_DEDUP_TTL_MS,
  createSpanStorageBroadcastHandler,
} from "./subscribers/span-storage-broadcast.subscriber";
export {
  TRACE_UPDATE_BROADCAST_WINDOW_MS,
  createTraceUpdateBroadcastHandler,
} from "./subscribers/trace-update-broadcast.subscriber";
export {
  TRACKED_EVENT_SYNC_DEDUP_TTL_MS,
  TRACKED_EVENT_SYNC_DELAY_MS,
  createTrackedEventSyncHandler,
  hasSyncableFeedback,
  trackedEventSyncDedupId,
} from "./subscribers/tracked-event-sync.subscriber";
export { parseJsonStringValues } from "./services/otlp-trace-request.rules";
export { IdUtils } from "./services/span-record-identity.rules";
export { TraceListClickHouseRepository } from "./repositories/clickhouse/trace-list.repository";
export { TraceSummaryClickHouseRepository } from "./repositories/clickhouse/trace-summary.repository";
export { TraceAnalyticsClickHouseRepository } from "./repositories/clickhouse/trace-analytics.repository";
export { TraceAnalyticsRollupClickHouseRepository } from "./repositories/clickhouse/trace-analytics-rollup.repository";
export {
  NullTraceSummaryRepository,
  type FindByTraceIdOptions,
  type TraceSummaryRepository,
} from "./repositories/trace-summary.repository";
export {
  NullTraceAnalyticsRepository,
  type TraceAnalyticsRepository,
} from "./repositories/trace-analytics.repository";
export {
  NullTraceAnalyticsRollupRepository,
  type TraceAnalyticsRollupRepository,
} from "./repositories/trace-analytics-rollup.repository";
export type { TraceClickHouseResolver } from "./ports/clickhouse.port";
export {
  TraceWindowedReadMetricsPort,
  type TraceWindowedReadOutcome,
} from "./ports/trace-windowed-read-metrics.port";
export { TraceRecordPort } from "./ports/trace-record.port";

export { TracePayloadReaderPort } from "./ports/trace-payload-reader.port";
export { TraceFullIoPort } from "./ports/trace-full-io.port";
export { TraceEventDerivationPort } from "./ports/trace-event-derivation.port";
export { TraceQueryFieldValuesPort } from "./ports/query-field-values.port";

export { TraceQueryClassificationAdapter } from "./adapters/trace-query-classification.adapter";
export {
  extractFreeTextTerms,
  translateFilterToClickHouse,
} from "./adapters/trace-query.clickhouse.adapter";

export {
  FACET_REGISTRY,
  TABLE_TIME_COLUMNS,
  type ExpressionCategoricalDef,
  type FacetDefinition,
  type FacetTable,
  type RangeFacetDef,
} from "./adapters/trace-facet-registry.clickhouse.adapter";
export { buildSpanAttributeKeysFacetQuery } from "./adapters/trace-facet-span-attribute-keys.clickhouse.adapter";
export { evaluateQueryInMemory, queryNeeds } from "./services/trace-query-evaluation.service";
export type { FieldDef } from "./adapters/trace-query-evaluation.adapter";
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
} from "./services/trace-ingestion.service";
export {
  DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES,
  capOversizedAttributes,
  hasOversizedAttribute,
} from "./services/trace-attribute-cap.rules";
export { capPayloadString } from "./services/trace-payload-cap.rules";
export {
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
  shouldOverrideOutput,
  TraceIOAccumulationService,
} from "./services/trace-io-accumulation.service";

export { SpanTimingService } from "./services/span-timing.service";

export { TraceProjectionRuntimeService } from "./services/trace-projection-runtime.service";
export {
  aggregateScenarioRoleMetrics,
  deriveScenarioRoleMetricsFromSpans,
  type ScenarioRoleMetrics,
  type ScenarioRoleSpanInput,
} from "./services/scenario-role-metrics.rules";

export { TraceApp } from "./app/trace.app";
export {
  SpansTrpcApi,
  type SpansTrpcContext,
  type SpansTrpcPorts,
} from "./transport/api-trpc/spans.api";
export {
  TraceEditOverlayTrpcApi,
  type TraceEditOverlayTrpcContext,
  type TraceEditOverlayTrpcPorts,
  type TraceEditOverlayVisibilityWindow,
} from "./transport/api-trpc/trace-edit-overlay.api";
export {
  TracesTrpcApi,
  type TracesTrpcContext,
  type TracesTrpcPorts,
} from "./transport/api-trpc/traces.api";
export {
  canReadCapturedContent,
  type CategoryVisibility,
  type Protections,
} from "./services/trace-viewer-protections.service";
export { redactHiddenAttributes } from "./services/trace-attribute-redaction.service";
export {
  buildContentPrivacy,
  contentSearchTermsForViewer,
  gateTraceLogVisibility,
  mapTraceSummaryToHeader,
  redactTraceLogContent,
  redactV2Content,
  toConversationContextTurn,
  type TraceContentPrivacyPort,
  type V2Protections,
} from "./transport/api-trpc/trace-read-mappers.api";
export {
  TracesV2TrpcApi,
  type TracesV2ReadPorts,
  type TracesV2TrpcContext,
  type TracesV2TrpcPorts,
} from "./transport/api-trpc/traces-v2.api";
export {
  SharedTraceTrpcApi,
  type SharedTraceTrpcContext,
  type SharedTraceTrpcPorts,
} from "./transport/api-trpc/shared-trace.api";
export {
  gateEvaluations,
  gateHeaderCost,
  gateResources,
  gateSessionCost,
  gateSessionTitle,
  gateTreeCost,
  withoutHiddenResourceAttrs,
} from "./transport/api-trpc/trace-view-gates.api";
export {
  createEventsRestApp,
  type TrackedEventPorts,
} from "./transport/api-rest/tracked-event.api";
export {
  createExportTracesRestApp,
  type TraceExportPort,
  type TraceExportRequestFields,
  type TraceExportRestPorts,
} from "./transport/api-rest/trace-export.api";
export {
  deserializeAttributes,
  ensureStringRecord,
  type FullSpanRow,
  mapChRowToNormalized,
  serializeAttributes,
} from "./repositories/clickhouse/stored-span-row.codec";
export {
  enrichRagContextIds,
  generateDocumentId,
  SpanNormalizationPipelineService,
} from "./services/span-normalization.service";
