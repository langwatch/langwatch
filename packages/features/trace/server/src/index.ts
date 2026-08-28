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
export { TraceProcessingServerInstaller } from "./adapters/eventing.trace-processing.installer";
export { TraceProcessingInstallerPort } from "./ports/trace-processing-installer.port";
export {
  createDeferredOriginHandler,
  createOriginGateHandler,
  DEFERRED_ORIGIN_CHECK_DELAY_MS,
  type DeferredOriginPayload,
  makeDeferredOriginJobId,
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
  extractEvaluationsFromSpan,
  hasSyncableEvaluations,
  type CustomEvaluationSyncSubscriberDeps,
} from "./subscribers/custom-evaluation-sync.subscriber";
export {
  EXPERIMENT_METRICS_SYNC_DEDUP_TTL_MS,
  EXPERIMENT_METRICS_SYNC_DELAY_MS,
  createExperimentMetricsSyncHandler,
  hasExperimentCostMetrics,
  type ExperimentMetricsSyncSubscriberDeps,
} from "./subscribers/experiment-metrics-sync.subscriber";
export {
  PROJECT_METADATA_WINDOW_MS,
  createProjectMetadataHandler,
  isRealFirstIngest,
  projectMetadataGroupKey,
  type ProjectMetadataSubscriberDeps,
} from "./subscribers/project-metadata.subscriber";
export {
  SIMULATION_METRICS_SYNC_DEDUP_TTL_MS,
  SIMULATION_METRICS_SYNC_DELAY_MS,
  createSimulationMetricsSyncHandler,
  hasSimulationMetrics,
  type SimulationMetricsSyncSubscriberDeps,
} from "./subscribers/simulation-metrics-sync.subscriber";
export {
  SPAN_STORAGE_BROADCAST_DEDUP_TTL_MS,
  createSpanStorageBroadcastHandler,
  type SpanStorageBroadcastSubscriberDeps,
} from "./subscribers/span-storage-broadcast.subscriber";
export {
  TRACE_UPDATE_BROADCAST_WINDOW_MS,
  createTraceUpdateBroadcastHandler,
  type TraceBroadcastSink,
  type TraceUpdateBroadcastSubscriberDeps,
} from "./subscribers/trace-update-broadcast.subscriber";
export {
  TRACKED_EVENT_SYNC_DEDUP_TTL_MS,
  TRACKED_EVENT_SYNC_DELAY_MS,
  createTrackedEventSyncHandler,
  hasSyncableFeedback,
  trackedEventSyncDedupId,
  type TrackedEventSyncSubscriberDeps,
} from "./subscribers/tracked-event-sync.subscriber";
export {
  normalizeOtlpAttributeMap,
  parseJsonStringValues,
  sanitizeInvalidJsonEscapes,
  TraceRequestUtils,
  type ParentContext,
  type TraceFlagsInfo,
  type TraceStateInfo,
} from "./services/otlp-trace-request.rules";
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
export type {
  TraceClickHouseClient,
  TraceClickHouseResolver,
  TraceClickHouseWriteClient,
  TraceClickHouseWriteResolver,
} from "./ports/clickhouse.port";
export {
  TraceWindowedReadMetricsPort,
  type TraceWindowedReadOutcome,
} from "./ports/trace-windowed-read-metrics.port";
export { TraceRecordPort } from "./ports/trace-record.port";
export { TraceFullRecordPort } from "./ports/trace-full-record.port";
export { TraceTopicAssignmentCommandPort } from "./ports/trace-topic-assignment-command.port";
export { TracePayloadReaderPort } from "./ports/trace-payload-reader.port";
export { TraceFullIoPort } from "./ports/trace-full-io.port";
export { TraceEventDerivationPort } from "./ports/trace-event-derivation.port";
export { TraceQueryFieldValuesPort } from "./ports/query-field-values.port";
export { TraceQueryClassificationPort } from "./ports/trace-query-classification.port";
export { TraceQueryClassificationAdapter } from "./adapters/trace-query-classification.adapter";
export {
  extractFreeTextTerms,
  normalizeQuery,
  translateFilterToClickHouse,
} from "./adapters/trace-query.clickhouse.adapter";
export {
  FIELD_DEFS,
  KNOWN_FIELDS,
  type KnownField,
} from "./adapters/trace-query-fields.clickhouse.adapter";
export {
  FACET_REGISTRY,
  TABLE_TIME_COLUMNS,
  type CategoricalFacetDef,
  type DynamicKeysDef,
  type ExpressionCategoricalDef,
  type FacetDefinition,
  type FacetGroup,
  type FacetQuery,
  type FacetQueryContext,
  type FacetTable,
  type QueryBuilderCategoricalDef,
  type RangeFacetDef,
} from "./adapters/trace-facet-registry.clickhouse.adapter";
export { buildSpanAttributeKeysFacetQuery } from "./adapters/trace-facet-span-attribute-keys.clickhouse.adapter";
export { evaluateQueryInMemory, queryNeeds } from "./services/trace-query-evaluation.service";
export type {
  DerivedSpanRow,
  FieldDef,
  FieldNeeds,
  InMemoryTrace,
  TraceQueryEvaluationRun,
} from "./adapters/trace-query-evaluation.adapter";
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
export {
  EventingTraceTopicAdapter as AssignTopicCommand,
  EventingTraceTopicAssignmentPort,
} from "./adapters/eventing.trace-topic.adapter";
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

export { TraceLegacyReadPort } from "./ports/trace-legacy-read.port";
export { SpansTrpcApi, type SpansTrpcContext, type SpansTrpcPorts } from "./api/app-trpc/spans.api";
export {
  TraceEditOverlayTrpcApi,
  type TraceEditOverlayTrpcContext,
  type TraceEditOverlayTrpcPorts,
  type TraceEditOverlayVisibilityWindow,
} from "./api/app-trpc/trace-edit-overlay.api";
export {
  TracesTrpcApi,
  type TracesTrpcContext,
  type TracesTrpcEmitters,
  type TracesTrpcPorts,
} from "./api/app-trpc/traces.api";
export {
  canReadCapturedContent,
  type CategoryVisibility,
  type Protections,
} from "./services/trace-viewer-protections.service";
export {
  compileHiddenAttributeMatchers,
  redactHiddenAttributes,
  redactHiddenAttributesCompiled,
} from "./services/trace-attribute-redaction.service";
export {
  buildContentPrivacy,
  buildSpanContentRedactions,
  contentSearchTermsForViewer,
  deriveTraceDropPrivacy,
  gateTraceLogVisibility,
  mapLegacySpanSummaryToTreeNode,
  mapSpanToDetail,
  mapSpansToDetailDtos,
  mapTraceSummaryToHeader,
  readDroppedFromParams,
  readPiiIncompleteFromParams,
  redactTraceLogContent,
  redactV2Content,
  toConversationContextTurn,
  type TraceContentPrivacyPort,
  type TraceDerivedAttrPrefixes,
  type TraceReadMapperPorts,
  type TraceSpanDisplayPort,
  type TraceSpanProtectionPort,
  type V2Protections,
} from "./api/app-trpc/trace-read-mappers.api";
export {
  TracesV2TrpcApi,
  type TracesV2CodingAgentEnrichmentPort,
  type TracesV2ListReader,
  type TracesV2ReadPorts,
  type TracesV2SessionGroupsReader,
  type TracesV2SpanReader,
  type TracesV2TrpcContext,
  type TracesV2TrpcPorts,
  type TraceLogRecordReadRow,
} from "./api/app-trpc/traces-v2.api";
export {
  SharedTraceTrpcApi,
  type SharedTraceTrpcContext,
  type SharedTraceTrpcPorts,
} from "./api/app-trpc/shared-trace.api";
export {
  gateEvaluations,
  gateHeaderCost,
  gateResources,
  gateSessionCost,
  gateSessionTitle,
  gateTreeCost,
  HIDDEN_RESOURCE_ATTRS,
  withoutHiddenResourceAttrs,
  type SessionTitleRedactionFlag,
} from "./api/app-trpc/trace-view-gates.api";
