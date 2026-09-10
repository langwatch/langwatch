export { TraceSpanCostMatchingService } from "./services/trace-span-cost-matching.service.ts";
export { ClickHouseTraceAdapter } from "./adapters/clickhouse.trace.adapter.ts";
export { TraceCanonicalisationService } from "./services/trace-canonicalisation.service.ts";
/**
 * The platform's retention policy in the shape the ClickHouse package asks for. Exported because
 * Evaluation's own ClickHouse repository takes the same floor port, and a second floor would let
 * a trace and the evaluations behind it disagree about how far back a project's rows go.
 */
export { TraceRetentionFloorService } from "./services/trace-retention-floor.service.ts";
export { NullTraceListAdapter } from "./adapters/null-trace-list.adapter.ts";
export {
  EventingTracePipelineAdapter,
  type EventingTracePipelineAdapterOptions,
} from "./adapters/eventing.trace-pipeline.adapter.ts";

export { TraceProcessingServerInstallerAdapter } from "./adapters/eventing.trace-processing-installer.adapter.ts";
export {
  TraceProcessingInstallerPort,
  type TraceProcessingCommands,
} from "./ports/trace-processing-installer.port.ts";
export {
  DEFERRED_ORIGIN_CHECK_DELAY_MS,
  ORIGIN_GATE_DEDUP_TTL_MS,
  ORIGIN_GATE_DELAY_MS,
  TraceDeferredOriginEventingAdapter,
  TraceDeferredOriginSchedulerPort,
} from "./adapters/eventing.deferred-origin.adapter.ts";
export { TraceProcessingPipelinePort } from "./ports/trace-processing-pipeline.port.ts";
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
export { OtlpAttributeFlatteningService } from "./services/otlp-attribute-flattening.service.ts";
export { SpanRecordIdentityService } from "./services/span-record-identity.service.ts";
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
} from "./ports/clickhouse.port.ts";
export {
  TraceWindowedReadMetricsPort,
  type TraceWindowedReadOutcome,
} from "./ports/trace-windowed-read-metrics.port.ts";
export { TraceRecordPort } from "./ports/trace-record.port.ts";

export { TracePayloadReaderPort } from "./ports/trace-payload-reader.port.ts";
export { TraceFullIoPort } from "./ports/trace-full-io.port.ts";
export { TraceEventDerivationPort } from "./ports/trace-event-derivation.port.ts";
export { TraceQueryFieldValuesPort } from "./ports/query-field-values.port.ts";

export { TraceQueryClassificationAdapter } from "./adapters/trace-query-classification.adapter.ts";
export { TraceQueryClickHouseAdapter } from "./adapters/trace-query.clickhouse.adapter.ts";

export {
  ClickHouseFacetRegistryAdapter,
  type ExpressionCategoricalDef,
  type FacetDefinition,
  type FacetTable,
  type RangeFacetDef,
} from "./adapters/trace-facet-registry.clickhouse.adapter.ts";
export { ClickHouseSpanAttributeKeysFacetAdapter } from "./adapters/trace-facet-span-attribute-keys.clickhouse.adapter.ts";
export { TraceQueryEvaluationAdapter } from "./adapters/trace-query-evaluation.adapter.ts";
export type { FieldDef } from "@langwatch/trace-contract";
export { TraceSummaryReaderPort } from "./ports/trace-summary-reader.port.ts";
export {
  TraceSummaryProjectionPort,
  type TraceSummaryProjectionEntry,
  type TraceSummaryReadWindow,
} from "./ports/trace-summary-projection.port.ts";
export {
  TraceSpanContentDropPort,
  type TraceSpanContentDropResult,
  TraceSpanCostEnrichmentPort,
  TraceSpanPiiRedactionPort,
  TraceSpanTokenEstimationPort,
} from "./ports/trace-span-preparation.port.ts";
export { TraceSpanSpoolPort, type TraceSpanSpoolIdentity } from "./ports/trace-span-spool.port.ts";
export { TraceSpanNormalizationPort } from "./ports/trace-span-normalization.port.ts";
export { TraceSpanStoragePort } from "./ports/trace-span-storage.port.ts";
export { ClickHouseTraceSpanStorageAdapter } from "./adapters/clickhouse.trace-span-storage.adapter.ts";
export { TraceStoredSpanReaderPort } from "./ports/trace-stored-span-reader.port.ts";
export { TraceDerivationSpanReaderPort } from "./ports/trace-derivation-span-reader.port.ts";
export { ClickHouseTraceDerivationSpanReaderAdapter } from "./adapters/clickhouse.trace-derivation-span-reader.adapter.ts";
export { TraceEventDerivationService } from "./services/trace-event-derivation.service.ts";
export {
  ScenarioRoleMetricsDerivationService,
  type ScenarioRoleMetricsDerivationInput,
} from "./services/scenario-role-metrics-derivation.service.ts";
export { TraceSpanCollectionService } from "./services/trace-ingestion.service.ts";
export { TrackedEventSpanService } from "./services/tracked-event-span.service.ts";
export {
  ClickHouseTraceProjectionStorageAdapter,
  type ClickHouseTraceProjectionStorageOptions,
} from "./adapters/clickhouse.trace-projection-storage.adapter.ts";
export { ClickHouseTraceStoredSpanReaderAdapter } from "./adapters/clickhouse.trace-stored-span-reader.adapter.ts";
export {
  TraceAnalyticsProjectionPort,
  type TraceAnalyticsProjectionEntry,
  type TraceAnalyticsProjectionRead,
} from "./ports/trace-analytics-projection.port.ts";
export { TraceAnalyticsRollupPort } from "./ports/trace-analytics-rollup.port.ts";
export {
  RECORD_SPAN_DEDUPLICATION,
  EventingRecordSpanAdapter as RecordSpanCommand,
  type RecordSpanCommandOptions,
} from "./adapters/eventing.record-span.adapter.ts";
export { EventingTraceTopicAdapter as AssignTopicCommand } from "./adapters/eventing.trace-topic-assignment.adapter.ts";

export { EventingTraceLogContributionAdapter as RecordLogContributionCommand } from "./adapters/eventing.trace-log-contribution.adapter.ts";
export { EventingTraceMetricCorrelationAdapter as RecordMetricCorrelationCommand } from "./adapters/eventing.trace-metric-correlation.adapter.ts";
export type {
  TraceQueryFieldValuesInput,
  TraceQueryFieldValuesResult,
} from "./ports/query-field-values.port.ts";
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
export { SpanCostService } from "./services/span-cost.service.ts";
export {
  TraceIngestionService,
  TraceIngressCommandPort,
  TraceIngressPayloadPort,
  TraceSpanDedupPort,
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

export { TraceProjectionRuntimeService } from "./services/trace-projection-runtime.service.ts";
export {
  IO_ATTR_KEYS,
  IO_PREVIEW_BYTES,
  TraceProjectionLeanService,
} from "./services/trace-projection-lean.service.ts";
export { TraceProjectionLeanEventingAdapter } from "./adapters/eventing.trace-projection-lean.adapter.ts";
export { TraceIoExtractionAdapter } from "./adapters/trace-io-extraction.adapter.ts";
export { TraceSpanNormalizationAdapter } from "./adapters/trace-span-normalization.adapter.ts";
export { TraceMediaReferenceAdapter } from "./adapters/trace-media-reference.adapter.ts";
export { ModelCatalogTraceModelCostAdapter } from "./adapters/model-catalog.trace-model-cost.adapter.ts";
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
export {
  TraceSpoolLegacyObjectPort,
  TraceSpoolStoragePort,
  type TraceSpoolObjectStore,
} from "./ports/trace-spool-storage.port.ts";
export {
  MAX_SPOOL_BYTES,
  SpoolDestinationUnsupportedError,
  TraceSpoolService,
  type TraceSpoolIdentity,
  type TraceSpoolServiceOptions,
} from "./services/trace-spool.service.ts";
export { TraceEdgeSpoolService } from "./services/trace-edge-spool.service.ts";
export { TraceEdgeMediaPayloadService } from "./services/trace-edge-media-payload.service.ts";
export { SPOOL_REF_V2 } from "./rules/trace-spool-location.rules.ts";
export {
  StreamTooLargeError,
  TraceStreamBufferService,
} from "./services/trace-stream-buffer.service.ts";
export { TraceSpanSpoolAdapter } from "./adapters/trace-span-spool.adapter.ts";
export {
  ClickHouseTracePayloadReaderAdapter,
  TRACE_PAYLOAD_AGGREGATE_TYPE,
} from "./adapters/clickhouse.trace-payload-reader.adapter.ts";
export { TraceTokenCounterPort } from "./ports/trace-token-counter.port.ts";
export {
  OtlpSpanTokenEstimationService,
  type OtlpSpanTokenEstimationServiceDependencies,
} from "./services/span-token-estimation.service.ts";
export { TraceSpanTokenEstimationAdapter } from "./adapters/trace-span-token-estimation.adapter.ts";
export { TraceProjectMetadataPort } from "./ports/trace-project-metadata.port.ts";
export { TraceModelCostCatalogPort } from "./ports/trace-model-cost-catalog.port.ts";
export { TraceEvaluationMonitorPort } from "./ports/trace-evaluation-monitor.port.ts";
export { TraceTenantBroadcastPort } from "./ports/trace-tenant-broadcast.port.ts";
export {
  TraceProductAnalyticsPort,
  type TraceProductEvent,
} from "./ports/trace-product-analytics.port.ts";
export {
  TraceEvaluationLoopMetricsPort,
  type TraceEvaluationLoopBlockReason,
} from "./ports/trace-evaluation-loop-metrics.port.ts";
export {
  EVALUATOR_LOOP_BLOCKED_METRIC_DESCRIPTION,
  EVALUATOR_LOOP_BLOCKED_METRIC_NAME,
  EVALUATOR_LOOP_BLOCKED_REASON_LABEL,
  OtelTraceEvaluationLoopMetricsAdapter,
} from "./adapters/otel.trace-evaluation-loop-metrics.adapter.ts";
export { OtlpSpanCostEnrichmentService } from "./services/span-cost-enrichment.service.ts";
export { TraceSpanCostEnrichmentAdapter } from "./adapters/trace-span-cost-enrichment.adapter.ts";
export { TraceEvaluationDispatchPort } from "./ports/trace-evaluation-dispatch.port.ts";
export {
  createEvaluationTriggerSubscriber,
  detectCausalityLoop,
  type EvaluationTriggerSubscriberDeps,
} from "./subscribers/evaluation-trigger.subscriber.ts";
export { TraceExistencePort } from "./ports/trace-existence.port.ts";
export { ClickHouseTraceExistenceRepository } from "./repositories/clickhouse/trace-existence.repository.ts";
export {
  TraceEditOverlayService,
  type TraceEditIOField,
} from "./services/trace-edit-overlay.service.ts";
export { TraceProcessingProducerAdapter } from "./adapters/trace-processing-producer.adapter.ts";

// The ClickHouse trace READ stack: everything a captured trace passes
// through between stored columns and what a reader may see — legacy read +
// repository, the explorer's list/sessions/spans/summary/log readers,
// offload resolution behind a full read, redaction/display passes, the
// coding-agent log join, the AI composer and the reserved-metadata write.
export {
  TraceLegacyReadClickHouseRepository,
  type TraceLegacyFilterConditions,
} from "./repositories/clickhouse/trace-legacy-read.repository.ts";
export {
  ClickHouseTraceLegacyReadAdapter,
  type ClickHouseTraceLegacyReadOptions,
} from "./adapters/clickhouse.trace-legacy-read.adapter.ts";
export type { TraceEditOverlayRow } from "./repositories/trace-edit-overlay.repository.ts";
export {
  TraceService as TraceLegacyReadService,
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
} from "./services/trace-blob-store.service.ts";
export { TraceIOExtractionService } from "./services/trace-io-extraction.service.ts";
export { TraceReadableSpanService } from "./services/trace-readable-span.service.ts";
export { VisibilityWindowService } from "./services/trace-visibility-window.service.ts";
export { TraceWindowedReadService } from "./services/trace-windowed-read.service.ts";
export { TraceTtlCacheService, type TraceCacheRedis } from "./services/trace-ttl-cache.service.ts";
export { TraceSpanIngestPort } from "./ports/trace-span-ingest.port.ts";
export {
  TraceMetadataWriteService,
  traceMetadataUpdateSchema,
  type TraceMetadataUpdate,
} from "./services/trace-metadata-write.service.ts";
export {
  TraceAiQueryService,
  type AiQueryInput,
  type AiQueryModelResolver,
} from "./services/trace-ai-query.service.ts";
export {
  DERIVED_INPUT_ATTR_PREFIX,
  DERIVED_OUTPUT_ATTR_PREFIX,
} from "./services/trace-log-content-derivation.service.ts";
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
} from "./services/trace-edge-media-extraction.service.ts";
export {
  TraceEdgeMediaTelemetryPort,
  TraceMediaStorePort,
  type TraceEdgeMediaFailOpenReason,
} from "./ports/trace-media-store.port.ts";
export { TraceContentArrayService } from "./services/trace-content-array.service.ts";
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
export { TraceContentReadServiceImpl } from "./services/trace-content-read.service.ts";

/** The REST projection compiler. Was `server/traces/projection/**`. */
export { TraceProjectionCompileService } from "./services/trace-projection-compile.service.ts";
export {
  TraceProjectionCatalogService,
  type FieldProtection,
  type ProjectionSource,
  type ResolvedField,
} from "./services/trace-projection-catalog.service.ts";
export {
  projectionRequestSchema,
  type CompiledProjection,
  type CompileProjectionArgs,
  type ProjectionRequest,
} from "@langwatch/trace-contract";
export {
  OtelTraceEdgeMediaTelemetryAdapter,
  TRACE_EDGE_MEDIA_FAIL_OPEN_METRIC_NAME,
} from "./adapters/otel.trace-edge-media-telemetry.adapter.ts";
export { traceServer, type TraceInfrastructure } from "./trace.server.ts";

export { spansTrpcTransport } from "./transport/spans.trpc.ts";
export { traceEditOverlayTrpcTransport } from "./transport/trace-edit-overlay.trpc.ts";
export { tracesTrpcTransport } from "./transport/traces.trpc.ts";

export {
  TrackedEventApi,
  trackedEventRest,
  trackedEventRestErrorHandler,
  type TrackedEventPorts,
} from "./transport/tracked-event.rest.ts";

export {
  TraceExportApi,
  traceExportRest,
  type TraceExportPort,
  type TraceExportRequestFields,
  type TraceExportRestPorts,
} from "./transport/trace-export.rest.ts";
