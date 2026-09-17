export { TraceSpanCostMatchingService } from "./services/trace-span-cost-matching.service.ts";
export {
  TraceTreeComposition,
  type TraceTreeCompositionOptions,
  type TraceTreeService,
} from "./app/trace-tree.composition.ts";
export { TraceCanonicalisationService } from "./services/trace-canonicalisation.service.ts";
/**
 * The platform's retention policy in the shape the ClickHouse package asks for. Exported because
 * Evaluation's own ClickHouse repository takes the same floor port, and a second floor would let
 * a trace and the evaluations behind it disagree about how far back a project's rows go.
 */
export { TraceRetentionFloorService } from "./services/trace-retention-floor.service.ts";
export { MemoryNullTraceListRepository } from "./repositories/memory/memory.null-trace-list.repository.ts";
export { traceRepositories } from "./repositories/trace-repositories.registry.ts";
export type { TraceRepositories } from "./repositories/trace.repositories.ts";
export {
  EventingTracePipelineAdapter,
  type EventingTracePipelineAdapterOptions,
} from "./services/eventing.trace-pipeline.service.ts";

export { TraceProcessingServerInstallerAdapter } from "./services/eventing.trace-processing-installer.service.ts";
export type { TraceProcessingInstaller, TraceProcessingCommands } from "./app/trace.members.ts";
export {
  DEFERRED_ORIGIN_CHECK_DELAY_MS,
  ORIGIN_GATE_DEDUP_TTL_MS,
  ORIGIN_GATE_DELAY_MS,
  TraceDeferredOriginEventingAdapter,
} from "./services/eventing.deferred-origin.service.ts";
export type { TraceDeferredOriginScheduler } from "./app/trace.members.ts";
export type { TraceProcessingPipeline } from "./app/trace.members.ts";
export {
  defineOriginGuardedTraceSubscriber,
  passesTraceOriginGuards,
  type TraceSummarySubscriber,
} from "./eventing/origin-guarded.subscriber.ts";
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
export { OtlpAttributeFlatteningService } from "./services/otlp-attribute-flattening.service.ts";
export { SpanRecordIdentityService } from "./services/span-record-identity.service.ts";
export { TraceListClickHouseRepository } from "./repositories/clickhouse/trace-list.repository.ts";
export { TraceSummaryClickHouseRepository } from "./repositories/clickhouse/trace-summary.repository.ts";
export {
  type FindByTraceIdOptions,
  type TraceSummaryRepository,
} from "./repositories/trace-summary.repository.ts";
export type {
  TraceClickHouseClient,
  TraceClickHouseResolver,
  TraceClickHouseWriteClient,
  TraceClickHouseWriteResolver,
} from "./repositories/trace-clickhouse-client.repository.ts";
export { TraceRecordRepository } from "./repositories/read/trace-record.repository.ts";

export { TracePayloadReaderRepository } from "./repositories/read/trace-payload-reader.repository.ts";
export type { TraceFullIo, TraceEventDerivation } from "./app/trace.members.ts";
export { TraceQueryFieldValuesRepository } from "./repositories/read/query-field-values.repository.ts";

export { TraceQueryClassificationAdapter } from "./services/trace-query-classification.service.ts";
export { ClickHouseTraceQueryRepository } from "./repositories/clickhouse/clickhouse.trace-query.repository.ts";

export {
  ClickHouseFacetRegistryAdapter,
  type ExpressionCategoricalDef,
  type FacetDefinition,
  type FacetTable,
  type RangeFacetDef,
} from "./repositories/clickhouse/clickhouse.trace-facet-registry.repository.ts";
export { ClickHouseTraceFacetSpanAttributeKeysRepository } from "./repositories/clickhouse/clickhouse.trace-facet-span-attribute-keys.repository.ts";
export { ClickhouseTraceQueryEvaluationRepository } from "./repositories/clickhouse/clickhouse.trace-query-evaluation.repository.ts";
export type { FieldDef } from "@langwatch/trace-contract";
export { TraceSummaryReaderRepository } from "./repositories/read/trace-summary-reader.repository.ts";
export {
  type TraceSummaryProjectionEntry,
  type TraceSummaryReadWindow,
} from "./repositories/projection/trace-summary-projection.repository.ts";
export type {
  TraceSpanContentDrop,
  TraceSpanContentDropResult,
  TraceSpanCostEnrichment,
  TraceSpanPiiRedaction,
  TraceSpanTokenEstimation,
  TraceSpanNormalization,
} from "./app/trace.members.ts";
export type { TraceSpanSpool, TraceSpanSpoolIdentity } from "./app/trace.members.ts";
export { TraceSpanStorageRepository } from "./repositories/span-storage-write.repository.ts";
export { TraceSpanStorageClickHouseRepository } from "./repositories/clickhouse/trace-span-storage.repository.ts";
export { TraceStoredSpanReaderRepository } from "./repositories/read/trace-stored-span-reader.repository.ts";
export { TraceDerivationSpanReaderRepository } from "./repositories/read/trace-derivation-span-reader.repository.ts";
export { TraceDerivationSpanClickHouseRepository } from "./repositories/clickhouse/trace-derivation-span.repository.ts";
export { TraceEventDerivationService } from "./services/trace-event-derivation.service.ts";
export {
  ScenarioRoleMetricsDerivationService,
  type ScenarioRoleMetricsDerivationInput,
} from "./services/scenario-role-metrics-derivation.service.ts";
export { TraceSpanCollectionService } from "./services/trace-ingestion.service.ts";
export { TrackedEventSpanService } from "./services/tracked-event-span.service.ts";
export { TraceSummaryProjectionClickHouseRepository } from "./repositories/clickhouse/trace-summary.repository.ts";
export { TraceAnalyticsClickHouseRepository } from "./repositories/clickhouse/trace-metrics-analytics.repository.ts";
export { TraceAnalyticsRollupClickHouseRepository } from "./repositories/clickhouse/trace-analytics-rollup.repository.ts";
export { TraceStoredSpanReaderClickHouseRepository } from "./repositories/clickhouse/trace-span-storage.repository.ts";
export {
  type TraceAnalyticsProjectionEntry,
  type TraceAnalyticsProjectionRead,
} from "./repositories/projection/trace-analytics-projection.repository.ts";
export { TraceAnalyticsRollupRepository } from "./repositories/projection/trace-analytics-rollup.repository.ts";
export {
  RECORD_SPAN_DEDUPLICATION,
  EventingRecordSpanAdapter,
  type RecordSpanCommandOptions,
} from "./services/eventing.record-span.service.ts";
export { EventingTraceTopicAdapter } from "./services/eventing.trace-topic-assignment.service.ts";

export { EventingTraceLogContributionAdapter } from "./services/eventing.trace-log-contribution.service.ts";
export { EventingTraceMetricCorrelationAdapter } from "./services/eventing.trace-metric-correlation.service.ts";
export type {
  TraceQueryFieldValuesInput,
  TraceQueryFieldValuesResult,
} from "./repositories/read/query-field-values.repository.ts";
export { MAX_PROCESSED_SPANS } from "./eventing/trace-summary.projection.ts";
export {
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT,
  type TraceAnalyticsData,
  type TraceAnalyticsRow,
} from "./eventing/trace-derived.projection.ts";
export { SpanStorageStore } from "./eventing/span-storage.store.ts";
export { TraceAnalyticsStore } from "./eventing/trace-derived.store.ts";
export { TraceAnalyticsRollupStore } from "./eventing/trace-rollup.store.ts";
export { TraceSummaryStore } from "./eventing/trace-summary.store.ts";
export { SpanCostService } from "./services/span-cost.service.ts";
export {
  TraceIngestionService,
  TraceIngressCommand,
  TraceIngressPayload,
  TraceSpanDedup,
  type CodingAgentIngestFilter,
  type SpanDedupRef,
} from "./services/trace-ingestion.service.ts";
export { TraceAttributeCapService } from "./services/trace-attribute-cap.service.ts";
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
export { TraceAttributeAccumulationService } from "./services/trace-attribute-accumulation.service.ts";
export { TraceAttributeExtractionService } from "./services/trace-attribute-extraction.service.ts";
export { TraceOriginService } from "./services/trace-origin.service.ts";
export { TraceIOAccumulationService } from "./services/trace-io-accumulation.service.ts";
export { TraceLogRecordIOService } from "./services/trace-log-record-io.service.ts";

export { SpanTimingService } from "./services/span-timing.service.ts";

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
export { TraceViewerProtectionsService } from "./services/trace-viewer-protections.service.ts";
export { TraceAttributeRedactionService } from "./services/trace-attribute-redaction.service.ts";
export {
  deserializeAttributes,
  ensureStringRecord,
  type FullSpanRow,
  mapChRowToNormalized,
  serializeAttributes,
} from "./repositories/clickhouse/stored-span-row.mapper.ts";
export { SpanNormalizationPipelineService } from "./services/span-normalization.service.ts";
export type {
  TraceSpoolLegacyObject,
  TraceSpoolStorage,
  TraceSpoolObjectStore,
} from "./app/trace.members.ts";
export {
  MAX_SPOOL_BYTES,
  SpoolDestinationUnsupportedError,
  TraceSpoolService,
  type TraceSpoolIdentity,
  type TraceSpoolServiceOptions,
} from "./services/trace-spool.service.ts";
export { TraceEdgeSpoolService } from "./services/edge/trace-edge-spool.service.ts";
export { TraceEdgeMediaPayloadService } from "./services/edge/trace-edge-media-payload.service.ts";
export { SPOOL_REF_V2 } from "./rules/trace-spool-location.rules.ts";
export {
  StreamTooLargeError,
  TraceStreamBufferService,
} from "./services/trace-stream-buffer.service.ts";
export { TraceSpanSpoolAdapter } from "./services/trace-span-spool.service.ts";
export { TRACE_PAYLOAD_AGGREGATE_TYPE } from "./repositories/clickhouse/trace-event-payload.repository.ts";
export type { TraceTokenCounter } from "./app/trace.members.ts";
export type { TraceSpanIngest } from "./app/trace.members.ts";
export {
  OtlpSpanTokenEstimationService,
  type OtlpSpanTokenEstimationServiceDependencies,
} from "./services/span-token-estimation.service.ts";
export { TraceSpanTokenEstimationAdapter } from "./services/trace-span-token-estimation-adapter.service.ts";
export type {
  TraceProjectMetadata,
  TraceModelCostCatalog,
  TraceEvaluationMonitor,
  TraceProductAnalytics,
  TraceProductEvent,
  TraceEvaluationLoopMetrics,
  TraceEvaluationLoopBlockReason,
} from "./app/trace.members.ts";
export type { TraceTenantBroadcast } from "./app/trace.members.ts";
export { TRACE_TENANT_BROADCAST_EVENT_TYPE } from "./app/trace.members.ts";
export {
  EVALUATOR_LOOP_BLOCKED_METRIC_DESCRIPTION,
  EVALUATOR_LOOP_BLOCKED_METRIC_NAME,
  EVALUATOR_LOOP_BLOCKED_REASON_LABEL,
  OtelTraceEvaluationLoopMetricsAdapter,
} from "./services/otel.trace-evaluation-loop-metrics.service.ts";
export { OtlpSpanCostEnrichmentService } from "./services/span-cost-enrichment.service.ts";
export { TraceSpanCostEnrichmentAdapter } from "./services/trace-span-cost-enrichment-adapter.service.ts";
export type { TraceEvaluationDispatch } from "./app/trace.members.ts";
export {
  createEvaluationTriggerSubscriber,
  detectCausalityLoop,
  type EvaluationTriggerSubscriberDeps,
} from "./eventing/evaluation-trigger.subscriber.ts";
export { TraceExistenceRepository } from "./repositories/read/trace-existence.repository.ts";
export { ClickHouseTraceExistenceRepository } from "./repositories/clickhouse/trace-existence.repository.ts";
export {
  TraceEditOverlayService,
  type TraceEditIOField,
} from "./services/trace-edit-overlay.service.ts";
export { TraceProcessingProducerAdapter } from "./services/trace-processing-producer.service.ts";

// The ClickHouse trace READ stack: everything a captured trace passes
// through between stored columns and what a reader may see — legacy read +
// repository, the explorer's list/sessions/spans/summary/log readers,
// offload resolution behind a full read, redaction/display passes, the
// coding-agent log join, the AI composer and the reserved-metadata write.
export type {
  TraceLegacyFilterConditions,
  ClickHouseTraceLegacyReadOptions,
} from "./repositories/clickhouse/trace-legacy-read.repository.ts";
export type { TraceLegacyReadRepository } from "./repositories/trace-legacy-read.repository.ts";
export type { TraceEditOverlayRow } from "./repositories/trace-edit-overlay.repository.ts";
export {
  TraceLegacyReadService,
  AmbiguousTraceIdPrefixError,
  type BlobResolutionDeps,
} from "./services/trace-legacy-read.service.ts";
export type {
  AggregationFiltersInput,
  GetAllTracesForProjectInput,
  GetAllTracesForProjectOptions,
  TraceDateField,
  TraceSharedFiltersInput,
} from "@langwatch/trace-contract";
export { TraceListService } from "./services/trace-list-read.service.ts";
export { SessionGroupsService } from "./services/trace-session-groups.service.ts";
export { SpanStorageService } from "./services/trace-span-storage-read.service.ts";
export { TraceSummaryService } from "./services/trace-summary-read.service.ts";
export { LogRecordStorageService } from "./services/trace-log-record-read.service.ts";
export { type SpanStorageRepository } from "./repositories/span-storage.repository.ts";
export { SpanStorageClickHouseRepository } from "./repositories/clickhouse/span-storage.repository.ts";
export { type SessionGroupsRepository } from "./repositories/session-groups.repository.ts";
export { SessionGroupsClickHouseRepository } from "./repositories/clickhouse/session-groups.repository.ts";
export { type LogRecordStorageRepository } from "./repositories/log-record-storage.repository.ts";
export { LogRecordStorageClickHouseRepository } from "./repositories/clickhouse/log-record-storage.repository.ts";
export {
  TraceBlobStoreService,
  type S3ClientResolution,
  type S3ClientResolver,
  type SpoolStorage,
} from "./services/trace-blob-store.service.ts";
export { TraceIOExtractionService } from "./services/trace-io-extraction.service.ts";
export { TraceReadableSpanService } from "./services/trace-readable-span.service.ts";
export { VisibilityWindowService } from "./services/trace-visibility-window.service.ts";
export { TraceTtlCacheService, type TraceCacheRedis } from "./services/trace-ttl-cache.service.ts";
export { TraceMetadataWriteService } from "./services/trace-metadata-write.service.ts";
export {
  TraceAiQueryService,
  type AiQueryInput,
  type AiQueryModelResolver,
} from "./services/trace-ai-query.service.ts";
export {
  DERIVED_INPUT_ATTR_PREFIX,
  DERIVED_OUTPUT_ATTR_PREFIX,
} from "./rules/trace-log-content-derivation.rules.ts";
export { ClaudeCodeLogEnrichmentService } from "./services/claude-code-log-enrichment.service.ts";
export type { ClaudeSpanRef } from "./rules/claude-code-message-index.rules.ts";
export { TraceReadRedactionService } from "./services/trace-read-redaction.service.ts";
export { TraceEditOverlayRedactionService } from "./services/trace-edit-overlay-redaction.service.ts";
export { TraceEditOverlayRestoreService } from "./services/trace-edit-overlay-restore.service.ts";
export { TraceCollectorSpanService } from "./services/trace-collector-span.service.ts";

export type { TraceRequestCollectionResult } from "./services/trace-ingestion.service.ts";

// The download half of the trace read: streaming CSV/JSONL export — the
// batched read, the two serialisers, the evaluation merge every reader
// shares, and the two refusals the transport publishes. filters is joined
// to the analytics schema at the mount; see trace-export.vocabulary.ts.
export { TraceExportService } from "./services/trace-export.service.ts";
export { TraceExportBoundsService } from "./services/trace-export-bounds.service.ts";
export type { TraceExportBounds, TraceExportSlot } from "./services/trace-export-bounds.service.ts";
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
export type { TraceEdgeMediaTelemetry, TraceEdgeMediaFailOpenReason } from "./app/trace.members.ts";
export { coerceContentToArray } from "./rules/trace-content-array.rules.ts";
export { binaryInputPartSchema } from "./rules/content-part-extraction.rules.ts";
export { TraceContentExtractionService } from "./services/trace-content-extraction.service.ts";
export type { ExtractedRef } from "./rules/content-part-extraction.rules.ts";
export {
  TraceValueMediaExtractionService,
  type ExtractionBudget,
} from "./services/trace-value-media-extraction.service.ts";

/** The agent-readable rendering of a trace. Was `server/traces/trace-formatting.ts`. */
export { TraceFormattingService } from "./services/trace-formatting.service.ts";
export {
  TraceViewerProtectionService,
  type TraceViewerProtectionOptions,
} from "./services/trace-viewer-protection.service.ts";
export {
  TraceViewerReadService,
  type TraceViewerServiceOptions,
} from "./services/trace-viewer.service.ts";
export { TraceContentReadService } from "./services/trace-content-read.service.ts";

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
export {
  traceServer,
  type TraceInfrastructure,
  createTracePayloadReader,
  createTraceLegacyRead,
} from "./trace.server.ts";

export { spansTrpcTransport } from "./transport/spans.trpc.ts";
export { traceEditOverlayTrpcTransport } from "./transport/trace-edit-overlay.trpc.ts";
export { tracesTrpcTransport } from "./transport/traces.trpc.ts";

export {
  TrackedEventApi,
  trackedEventRest,
  trackedEventRestErrorHandler,
  trackedEventLegacyPathRest,
  TRACKED_EVENT_CANONICAL_PATH,
  TRACKED_EVENT_LEGACY_PATH,
  type TrackedEventMembers,
} from "./transport/tracked-event.rest.ts";

export {
  TraceExportApi,
  traceExportRest,
  type TraceExport,
  type TraceExportRequestFields,
  type TraceExportRestMembers,
} from "./transport/trace-export.rest.ts";
