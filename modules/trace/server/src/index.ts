export { TraceSpanCostMatchingService } from "./services/span/trace-span-cost-matching.service.ts";
export {
  TraceTreeComposition,
  type TraceTreeCompositionOptions,
  type TraceTreeService,
} from "./app/trace-tree.composition.ts";
export { TraceCanonicalisationService } from "./services/canonicalisers/trace-canonicalisation.service.ts";
/**
 * The platform's retention policy in the shape the ClickHouse package asks for. Exported because
 * Evaluation's own ClickHouse repository takes the same floor port, and a second floor would let
 * a trace and the evaluations behind it disagree about how far back a project's rows go.
 */
export { TraceRetentionFloorService } from "./services/support/trace-retention-floor.service.ts";
export { NullTraceListAdapter } from "./repositories/memory/null-trace-list.adapter.ts";
export { traceRepositories } from "./repositories/trace-repositories.registry.ts";
export type { TraceRepositories } from "./repositories/trace.repositories.ts";
export {
  EventingTracePipelineAdapter,
  type EventingTracePipelineAdapterOptions,
} from "./services/eventing.trace-pipeline.service.ts";

export { TraceProcessingServerInstallerAdapter } from "./services/eventing.trace-processing-installer.service.ts";
export type {
  TraceProcessingInstaller as TraceProcessingInstallerPort,
  TraceProcessingCommands,
} from "./app/trace.infrastructure.ts";
export {
  DEFERRED_ORIGIN_CHECK_DELAY_MS,
  ORIGIN_GATE_DEDUP_TTL_MS,
  ORIGIN_GATE_DELAY_MS,
  TraceDeferredOriginEventingAdapter,
} from "./services/eventing.deferred-origin.service.ts";
export type { TraceDeferredOriginScheduler as TraceDeferredOriginSchedulerPort } from "./app/trace.infrastructure.ts";
export type { TraceProcessingPipeline as TraceProcessingPipelinePort } from "./app/trace.infrastructure.ts";
export {
  defineOriginGuardedTraceSubscriber,
  passesTraceOriginGuards,
  type TraceSummarySubscriber,
} from "./subscribers/origin-guarded.subscriber.ts";
export {
  CUSTOM_EVAL_SYNC_DEDUP_TTL_MS,
  CUSTOM_EVAL_SYNC_DELAY_MS,
  CustomEvaluationSync,
} from "./subscribers/custom-evaluation-sync.subscriber.ts";
export {
  EXPERIMENT_METRICS_SYNC_DEDUP_TTL_MS,
  EXPERIMENT_METRICS_SYNC_DELAY_MS,
  createExperimentMetricsSyncHandler,
  hasExperimentCostMetrics,
} from "./subscribers/experiment-metrics-sync.subscriber.ts";
export {
  PROJECT_METADATA_WINDOW_MS,
  ProjectMetadataSync,
} from "./subscribers/project-metadata.subscriber.ts";
export {
  SIMULATION_METRICS_SYNC_DEDUP_TTL_MS,
  SIMULATION_METRICS_SYNC_DELAY_MS,
  createSimulationMetricsSyncHandler,
  hasSimulationMetrics,
} from "./subscribers/simulation-metrics-sync.subscriber.ts";
export {
  SPAN_STORAGE_BROADCAST_DEDUP_TTL_MS,
  createSpanStorageBroadcastHandler,
} from "./subscribers/span-storage-broadcast.subscriber.ts";
export {
  TRACE_UPDATE_BROADCAST_WINDOW_MS,
  createTraceUpdateBroadcastHandler,
} from "./subscribers/trace-update-broadcast.subscriber.ts";
export {
  TRACKED_EVENT_SYNC_DEDUP_TTL_MS,
  TRACKED_EVENT_SYNC_DELAY_MS,
  TrackedEventSync,
} from "./subscribers/tracked-event-sync.subscriber.ts";
export { OtlpAttributeFlatteningService } from "./services/attribute/otlp-attribute-flattening.service.ts";
export { SpanRecordIdentityService } from "./services/span/span-record-identity.service.ts";
export { TraceListClickHouseRepository } from "./repositories/clickhouse/trace-list.repository.ts";
export { TraceSummaryClickHouseRepository } from "./repositories/clickhouse/trace-summary.repository.ts";
export {
  NullTraceSummaryRepository,
  type FindByTraceIdOptions,
  type TraceSummaryRepository,
} from "./repositories/trace-summary.repository.ts";
export type {
  TraceClickHouseClient,
  TraceClickHouseResolver,
  TraceClickHouseWriteClient,
  TraceClickHouseWriteResolver,
} from "./repositories/trace-clickhouse-client.repository.ts";
export type {
  TraceWindowedReadMetrics as TraceWindowedReadMetricsPort,
  TraceWindowedReadOutcome,
} from "./app/trace.infrastructure.ts";
export { TraceRecordRepository } from "./repositories/read/trace-record.repository.ts";

export { TracePayloadReaderRepository } from "./repositories/read/trace-payload-reader.repository.ts";
export type { TraceFullIo as TraceFullIoPort, TraceEventDerivation as TraceEventDerivationPort } from "./app/trace.infrastructure.ts";
export { TraceQueryFieldValuesRepository } from "./repositories/read/query-field-values.repository.ts";

export { TraceQueryClassificationAdapter } from "./services/trace-query-classification.service.ts";
export { TraceQueryClickHouseAdapter } from "./repositories/clickhouse/trace-query.clickhouse.adapter.ts";

export {
  ClickHouseFacetRegistryAdapter,
  type ExpressionCategoricalDef,
  type FacetDefinition,
  type FacetTable,
  type RangeFacetDef,
} from "./repositories/clickhouse/trace-facet-registry.clickhouse.adapter.ts";
export { ClickHouseSpanAttributeKeysFacetAdapter } from "./repositories/clickhouse/trace-facet-span-attribute-keys.clickhouse.adapter.ts";
export { ClickhouseTraceQueryEvaluationRepository as TraceQueryEvaluationAdapter } from "./repositories/clickhouse/clickhouse.trace-query-evaluation.repository.ts";
export type { FieldDef } from "@langwatch/trace-contract";
export { TraceSummaryReaderRepository } from "./repositories/read/trace-summary-reader.repository.ts";
export {
  TraceSummaryProjectionRepository,
  type TraceSummaryProjectionEntry,
  type TraceSummaryReadWindow,
} from "./repositories/projection/trace-summary-projection.repository.ts";
export type {
  TraceSpanContentDrop as TraceSpanContentDropPort,
  TraceSpanContentDropResult,
  TraceSpanCostEnrichment as TraceSpanCostEnrichmentPort,
  TraceSpanPiiRedaction as TraceSpanPiiRedactionPort,
  TraceSpanTokenEstimation as TraceSpanTokenEstimationPort,
  TraceSpanNormalization as TraceSpanNormalizationPort,
} from "./app/trace.infrastructure.ts";
export type { TraceSpanSpool as TraceSpanSpoolPort, TraceSpanSpoolIdentity } from "./app/trace.infrastructure.ts";
export { TraceSpanStorageRepository } from "./repositories/span-storage-write.repository.ts";
export { TraceSpanStorageClickHouseRepository } from "./repositories/clickhouse/trace-span-storage.repository.ts";
export { TraceStoredSpanReaderRepository } from "./repositories/read/trace-stored-span-reader.repository.ts";
export { TraceDerivationSpanReaderRepository } from "./repositories/read/trace-derivation-span-reader.repository.ts";
export { TraceDerivationSpanClickHouseRepository } from "./repositories/clickhouse/trace-derivation-span.repository.ts";
export { TraceEventDerivationService } from "./services/ingestion/trace-event-derivation.service.ts";
export {
  ScenarioRoleMetricsDerivationService,
  type ScenarioRoleMetricsDerivationInput,
} from "./services/support/scenario-role-metrics-derivation.service.ts";
export { TraceSpanCollectionService } from "./services/ingestion/trace-ingestion.service.ts";
export { TrackedEventSpanService } from "./services/span/tracked-event-span.service.ts";
export { TraceSummaryProjectionClickHouseRepository } from "./repositories/clickhouse/trace-summary.repository.ts";
export { TraceAnalyticsClickHouseRepository } from "./repositories/clickhouse/trace-metrics-analytics.repository.ts";
export { TraceAnalyticsRollupClickHouseRepository } from "./repositories/clickhouse/trace-analytics-rollup.repository.ts";
export { TraceStoredSpanReaderClickHouseRepository } from "./repositories/clickhouse/trace-span-storage.repository.ts";
export {
  TraceAnalyticsProjectionRepository,
  type TraceAnalyticsProjectionEntry,
  type TraceAnalyticsProjectionRead,
} from "./repositories/projection/trace-analytics-projection.repository.ts";
export { TraceAnalyticsRollupRepository } from "./repositories/projection/trace-analytics-rollup.repository.ts";
export {
  RECORD_SPAN_DEDUPLICATION,
  EventingRecordSpanAdapter as RecordSpanCommand,
  type RecordSpanCommandOptions,
} from "./services/eventing.record-span.service.ts";
export { EventingTraceTopicAdapter as AssignTopicCommand } from "./services/eventing.trace-topic-assignment.service.ts";

export { EventingTraceLogContributionAdapter as RecordLogContributionCommand } from "./services/eventing.trace-log-contribution.service.ts";
export { EventingTraceMetricCorrelationAdapter as RecordMetricCorrelationCommand } from "./services/eventing.trace-metric-correlation.service.ts";
export type {
  TraceQueryFieldValuesInput,
  TraceQueryFieldValuesResult,
} from "./repositories/read/query-field-values.repository.ts";
export {
  MAX_PROCESSED_SPANS,
  TraceSummaryFoldProjection,
} from "./projections/trace-summary.projection.ts";
export {
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT,
  type TraceAnalyticsData,
  TraceAnalyticsFoldProjection,
  type TraceAnalyticsRow,
} from "./projections/trace-derived.projection.ts";
export { SpanStorageStore } from "./stores/eventing/eventing.span-storage.store.ts";
export { TraceAnalyticsStore } from "./stores/eventing/eventing.trace-derived.store.ts";
export { TraceAnalyticsRollupStore } from "./stores/eventing/eventing.trace-rollup.store.ts";
export { TraceSummaryStore } from "./stores/eventing/eventing.trace-summary.store.ts";
export { SpanCostService } from "./services/span/span-cost.service.ts";
export {
  TraceIngestionService,
  TraceIngressCommandPort,
  TraceIngressPayloadPort,
  TraceSpanDedupPort,
  type CodingAgentIngestFilter,
  type SpanDedupRef,
} from "./services/ingestion/trace-ingestion.service.ts";
export { TraceAttributeCapService } from "./services/attribute/trace-attribute-cap.service.ts";
export {
  capPayloadString,
  DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES,
} from "./rules/trace-payload-cap.rules.ts";
export {
  MAX_SPAN_SHARD_COUNT,
  resolveSpanCommandShardCount,
  spanCommandGroupKey,
} from "./rules/trace-span-command-shard.rules.ts";
export { firstUsableAnchor } from "./rules/trace-storage-anchor.rules.ts";
export { anchorStorageTime } from "./rules/trace-storage-anchor.rules.ts";
export {
  SPAN_STORAGE_MAP_SHARD_COUNT,
  spanStorageMapGroupKey,
  TRACE_SPAN_MAP_COALESCE_MAX_BATCH,
} from "./rules/trace-span-storage-group.rules.ts";
export { trimAttributesForAnalytics } from "./rules/analytics-attribute-trim.rules.ts";
export { TraceAttributeAccumulationService } from "./services/attribute/trace-attribute-accumulation.service.ts";
export { TraceAttributeExtractionService } from "./services/attribute/trace-attribute-extraction.service.ts";
export { TraceOriginService } from "./services/read/trace-origin.service.ts";
export { TraceIOAccumulationService } from "./services/content/trace-io-accumulation.service.ts";
export { TraceLogRecordIOService } from "./services/log/trace-log-record-io.service.ts";

export { SpanTimingService } from "./services/span/span-timing.service.ts";

export { TraceProjectionRuntimeService } from "./services/projection/trace-projection-runtime.service.ts";
export {
  IO_ATTR_KEYS,
  IO_PREVIEW_BYTES,
  TraceProjectionLeanService,
} from "./services/projection/trace-projection-lean.service.ts";
export { TraceProjectionLeanEventingAdapter } from "./services/eventing.trace-projection-lean.service.ts";
export { TraceIoExtractionAdapter } from "./services/trace-io-extraction-adapter.service.ts";
export { TraceSpanNormalizationAdapter } from "./services/trace-span-normalization-adapter.service.ts";
export { TraceMediaReferenceAdapter } from "./services/trace-media-reference.service.ts";
export { ModelCatalogTraceModelCostAdapter } from "./services/model-catalog.trace-model-cost.service.ts";
export {
  aggregateScenarioRoleMetrics,
  deriveScenarioRoleMetricsFromSpans,
  type ScenarioRoleMetrics,
  type ScenarioRoleSpanInput,
} from "./rules/scenario-role-metrics.rules.ts";

export {
  TraceApp,
  type TraceAppDependencies,
  type TraceProjectReader,
  type TraceShareReader,
  type TracesTopicReader,
  type TracesTrpcEmitters,
} from "./app/trace.app.ts";
export { TraceViewerProtectionsService } from "./services/viewer/trace-viewer-protections.service.ts";
export { TraceAttributeRedactionService } from "./services/attribute/trace-attribute-redaction.service.ts";
export {
  deserializeAttributes,
  ensureStringRecord,
  type FullSpanRow,
  mapChRowToNormalized,
  serializeAttributes,
} from "./repositories/clickhouse/stored-span-row.mapper.ts";
export { SpanNormalizationPipelineService } from "./services/span/span-normalization.service.ts";
export type {
  TraceSpoolLegacyObject as TraceSpoolLegacyObjectPort,
  TraceSpoolStorage as TraceSpoolStoragePort,
  TraceSpoolObjectStore,
} from "./app/trace.infrastructure.ts";
export {
  MAX_SPOOL_BYTES,
  SpoolDestinationUnsupportedError,
  TraceSpoolService,
  type TraceSpoolIdentity,
  type TraceSpoolServiceOptions,
} from "./services/ingestion/trace-spool.service.ts";
export { TraceEdgeSpoolService } from "./services/edge/trace-edge-spool.service.ts";
export { TraceEdgeMediaPayloadService } from "./services/edge/trace-edge-media-payload.service.ts";
export { SPOOL_REF_V2 } from "./rules/trace-spool-location.rules.ts";
export {
  StreamTooLargeError,
  TraceStreamBufferService,
} from "./services/ingestion/trace-stream-buffer.service.ts";
export { TraceSpanSpoolAdapter } from "./services/trace-span-spool.service.ts";
export {
  ClickHouseTraceEventPayloadRepository,
  TRACE_PAYLOAD_AGGREGATE_TYPE,
} from "./repositories/clickhouse/trace-event-payload.repository.ts";
export type { TraceTokenCounter as TraceTokenCounterPort } from "./app/trace.infrastructure.ts";
export type { TraceSpanIngest as TraceSpanIngestPort } from "./app/trace.infrastructure.ts";
export {
  OtlpSpanTokenEstimationService,
  type OtlpSpanTokenEstimationServiceDependencies,
} from "./services/span/span-token-estimation.service.ts";
export { TraceSpanTokenEstimationAdapter } from "./services/trace-span-token-estimation-adapter.service.ts";
export type {
  TraceProjectMetadata as TraceProjectMetadataPort,
  TraceModelCostCatalog as TraceModelCostCatalogPort,
  TraceEvaluationMonitor as TraceEvaluationMonitorPort,
  TraceProductAnalytics as TraceProductAnalyticsPort,
  TraceProductEvent,
  TraceEvaluationLoopMetrics as TraceEvaluationLoopMetricsPort,
  TraceEvaluationLoopBlockReason,
} from "./app/trace.infrastructure.ts";
export type { TraceTenantBroadcast as TraceTenantBroadcastPort } from "./app/trace.infrastructure.ts";
export { TRACE_TENANT_BROADCAST_EVENT_TYPE } from "./app/trace.infrastructure.ts";
export {
  EVALUATOR_LOOP_BLOCKED_METRIC_DESCRIPTION,
  EVALUATOR_LOOP_BLOCKED_METRIC_NAME,
  EVALUATOR_LOOP_BLOCKED_REASON_LABEL,
  OtelTraceEvaluationLoopMetricsAdapter,
} from "./services/otel.trace-evaluation-loop-metrics.service.ts";
export { OtlpSpanCostEnrichmentService } from "./services/span/span-cost-enrichment.service.ts";
export { TraceSpanCostEnrichmentAdapter } from "./services/trace-span-cost-enrichment-adapter.service.ts";
export type { TraceEvaluationDispatch as TraceEvaluationDispatchPort } from "./app/trace.infrastructure.ts";
export {
  createEvaluationTriggerSubscriber,
  detectCausalityLoop,
  type EvaluationTriggerSubscriberDeps,
} from "./subscribers/evaluation-trigger.subscriber.ts";
export { TraceExistenceRepository } from "./repositories/read/trace-existence.repository.ts";
export { ClickHouseTraceExistenceRepository } from "./repositories/clickhouse/trace-existence.repository.ts";
export {
  TraceEditOverlayService,
  type TraceEditIOField,
} from "./services/edit-overlay/trace-edit-overlay.service.ts";
export { TraceProcessingProducerAdapter } from "./services/trace-processing-producer.service.ts";

// The ClickHouse trace READ stack: everything a captured trace passes
// through between stored columns and what a reader may see — legacy read +
// repository, the explorer's list/sessions/spans/summary/log readers,
// offload resolution behind a full read, redaction/display passes, the
// coding-agent log join, the AI composer and the reserved-metadata write.
export {
  TraceLegacyReadClickHouseRepository,
  type TraceLegacyFilterConditions,
  type ClickHouseTraceLegacyReadOptions,
} from "./repositories/clickhouse/trace-legacy-read.repository.ts";
export type { TraceEditOverlayRow } from "./repositories/trace-edit-overlay.repository.ts";
export {
  TraceService as TraceLegacyReadService,
  AmbiguousTraceIdPrefixError,
  type BlobResolutionDeps,
} from "./services/read/trace-legacy-read.service.ts";
export type {
  AggregationFiltersInput,
  GetAllTracesForProjectInput,
  GetAllTracesForProjectOptions,
  TraceDateField,
  TraceSharedFiltersInput,
} from "@langwatch/trace-contract";
export { TraceListService } from "./services/read/trace-list-read.service.ts";
export { SessionGroupsService } from "./services/session/trace-session-groups.service.ts";
export { SpanStorageService } from "./services/offload/trace-span-storage-read.service.ts";
export { TraceSummaryService } from "./services/read/trace-summary-read.service.ts";
export { LogRecordStorageService } from "./services/log/trace-log-record-read.service.ts";
export {
  NullSpanStorageRepository,
  type SpanStorageRepository,
} from "./repositories/span-storage.repository.ts";
export { SpanStorageClickHouseRepository } from "./repositories/clickhouse/span-storage.repository.ts";
export {
  NullSessionGroupsRepository,
  type SessionGroupsRepository,
} from "./repositories/session-groups.repository.ts";
export { SessionGroupsClickHouseRepository } from "./repositories/clickhouse/session-groups.repository.ts";
export {
  NullLogRecordStorageRepository,
  type LogRecordStorageRepository,
} from "./repositories/log-record-storage.repository.ts";
export { LogRecordStorageClickHouseRepository } from "./repositories/clickhouse/log-record-storage.repository.ts";
export {
  TraceBlobStoreService,
  type S3ClientResolution,
  type S3ClientResolver,
  type SpoolStorage,
} from "./services/offload/trace-blob-store.service.ts";
export { TraceIOExtractionService } from "./services/content/trace-io-extraction.service.ts";
export { TraceReadableSpanService } from "./services/read/trace-readable-span.service.ts";
export { VisibilityWindowService } from "./services/viewer/trace-visibility-window.service.ts";
export { TraceWindowedReadService } from "./services/read/trace-windowed-read.service.ts";
export { TraceTtlCacheService, type TraceCacheRedis } from "./services/support/trace-ttl-cache.service.ts";
export {
  TraceMetadataWriteService,
  traceMetadataUpdateSchema,
  type TraceMetadataUpdate,
} from "./services/support/trace-metadata-write.service.ts";
export {
  TraceAiQueryService,
  type AiQueryInput,
  type AiQueryModelResolver,
} from "./services/query/trace-ai-query.service.ts";
export {
  DERIVED_INPUT_ATTR_PREFIX,
  DERIVED_OUTPUT_ATTR_PREFIX,
} from "./services/log/trace-log-content-derivation.service.ts";
export { ClaudeCodeLogEnrichmentService } from "./services/canonicalisers/coding-agent/claude-code-log-enrichment.service.ts";
export type { ClaudeSpanRef } from "./rules/claude-code-message-index.rules.ts";
export { TraceReadRedactionService } from "./services/read/trace-read-redaction.service.ts";
export { TraceEditOverlayRedactionService } from "./services/edit-overlay/trace-edit-overlay-redaction.service.ts";
export { TraceEditOverlayRestoreService } from "./services/edit-overlay/trace-edit-overlay-restore.service.ts";
export { TraceCollectorSpanService } from "./services/span/trace-collector-span.service.ts";

export type { TraceRequestCollectionResult } from "./services/ingestion/trace-ingestion.service.ts";

// The download half of the trace read: streaming CSV/JSONL export — the
// batched read, the two serialisers, the evaluation merge every reader
// shares, and the two refusals the transport publishes. filters is joined
// to the analytics schema at the mount; see trace-export.vocabulary.ts.
export { TraceExportService } from "./services/query/trace-export.service.ts";
export {
  exportFormatSchema,
  exportModeSchema,
  exportProgressSchema,
  traceExportRequestShape,
  type ExportFormat,
  type ExportMode,
  type ExportProgress,
  type ExportRequest,
} from "@langwatch/trace-contract";
export { ExportFailedError, ExportUnauthenticatedError } from "@langwatch/trace-contract";
export {
  CSV_NEWLINE,
  serializeTracesToFullCsv,
  serializeTracesToSummaryCsv,
} from "./rules/trace-export-csv.rules.ts";
export {
  serializeTraceToFullJson,
  serializeTraceToSummaryJson,
} from "./rules/trace-export-json.rules.ts";
export { RESERVED_METADATA_KEYS } from "./rules/trace-export-columns.rules.ts";
export { enrichTracesWithEvaluations } from "./rules/trace-evaluation-enrichment.rules.ts";

/**
 * The edge media path: what a span carries inline, lifted into the object store before the
 * span folds. Belongs to this vertical, not Stored Objects, since it walks trace content parts
 * and media markers.
 */
export {
  TRACE_MEDIA_PURPOSE,
  TraceEdgeMediaExtractionService,
  type EdgeMediaExtractionDeps,
  type EdgeMediaExtractionLogger,
} from "./services/edge/trace-edge-media-extraction.service.ts";
export type {
  TraceEdgeMediaTelemetry as TraceEdgeMediaTelemetryPort,
  TraceMediaStore as TraceMediaStorePort,
  TraceEdgeMediaFailOpenReason,
} from "./app/trace.infrastructure.ts";
export { TraceContentArrayService } from "./services/content/trace-content-array.service.ts";
export { binaryInputPartSchema } from "./rules/content-part-extraction.rules.ts";
export { TraceContentExtractionService } from "./services/content/trace-content-extraction.service.ts";
export type { ExtractedRef } from "./rules/content-part-extraction.rules.ts";
export {
  TraceValueMediaExtractionService,
  type ExtractionBudget,
} from "./services/content/trace-value-media-extraction.service.ts";

/** The agent-readable rendering of a trace. Was `server/traces/trace-formatting.ts`. */
export { TraceFormattingService } from "./services/support/trace-formatting.service.ts";
export {
  TraceViewerProtectionService,
  type TraceViewerProtectionOptions,
} from "./services/viewer/trace-viewer-protection.service.ts";
export {
  TraceViewerReadService,
  type TraceViewerServiceOptions,
} from "./services/viewer/trace-viewer.service.ts";
export { TraceContentReadServiceImpl } from "./services/content/trace-content-read.service.ts";

/** The REST projection compiler. Was `server/traces/projection/**`. */
export { TraceProjectionCompileService } from "./services/projection/trace-projection-compile.service.ts";
export {
  TraceProjectionCatalogService,
  type FieldProtection,
  type ProjectionSource,
  type ResolvedField,
} from "./services/projection/trace-projection-catalog.service.ts";
export {
  projectionRequestSchema,
  type CompiledProjection,
  type CompileProjectionArgs,
  type ProjectionRequest,
} from "@langwatch/trace-contract";
export {
  OtelTraceEdgeMediaTelemetryAdapter,
  TRACE_EDGE_MEDIA_FAIL_OPEN_METRIC_NAME,
} from "./services/otel.trace-edge-media-telemetry.service.ts";
export { traceServer, type TraceInfrastructure } from "./trace.server.ts";

export { spansTrpcTransport } from "./transport/spans.trpc.ts";
export { traceEditOverlayTrpcTransport } from "./transport/trace-edit-overlay.trpc.ts";
export { tracesTrpcTransport } from "./transport/traces.trpc.ts";

export {
  TrackedEventApi,
  trackedEventRest,
  trackedEventRestErrorHandler,
  trackedEventLegacyPathRest,
  TrackedEventLegacyPathApi,
  TRACKED_EVENT_CANONICAL_PATH,
  TRACKED_EVENT_LEGACY_PATH,
  type TrackedEventPorts,
} from "./transport/tracked-event.rest.ts";

export {
  TraceExportApi,
  traceExportRest,
  type TraceExportPort,
  type TraceExportRequestFields,
  type TraceExportRestPorts,
} from "./transport/trace-export.rest.ts";
