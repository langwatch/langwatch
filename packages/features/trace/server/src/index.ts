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
  CustomEvaluationSync,
} from "./subscribers/custom-evaluation-sync.subscriber";
export {
  EXPERIMENT_METRICS_SYNC_DEDUP_TTL_MS,
  EXPERIMENT_METRICS_SYNC_DELAY_MS,
  createExperimentMetricsSyncHandler,
  hasExperimentCostMetrics,
} from "./subscribers/experiment-metrics-sync.subscriber";
export {
  PROJECT_METADATA_WINDOW_MS,
  ProjectMetadataSync,
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
  TrackedEventSync,
} from "./subscribers/tracked-event-sync.subscriber";
export { parseJsonStringValues } from "./services/otlp-trace-request.rules";
export { SpanRecordIdentity } from "./services/span-record-identity.rules";
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

export { TracePayloadReaderPort } from "./ports/trace-payload-reader.port";
export { TraceFullIoPort } from "./ports/trace-full-io.port";
export { TraceEventDerivationPort } from "./ports/trace-event-derivation.port";
export { TraceQueryFieldValuesPort } from "./ports/query-field-values.port";

export { TraceQueryClassificationAdapter } from "./adapters/trace-query-classification.adapter";
export { TraceQueryClickHouse } from "./adapters/trace-query.clickhouse.adapter";

export {
  FACET_REGISTRY,
  TABLE_TIME_COLUMNS,
  type ExpressionCategoricalDef,
  type FacetDefinition,
  type FacetTable,
  type RangeFacetDef,
} from "./adapters/trace-facet-registry.clickhouse.adapter";
export { buildSpanAttributeKeysFacetQuery } from "./adapters/trace-facet-span-attribute-keys.clickhouse.adapter";
export { TraceQueryEvaluationService } from "./services/trace-query-evaluation.service";
export type { FieldDef } from "./adapters/trace-query-evaluation.adapter";
export { TraceSummaryReaderPort } from "./ports/trace-summary-reader.port";
export {
  TraceSummaryProjectionPort,
  type TraceSummaryProjectionEntry,
  type TraceSummaryReadWindow,
} from "./ports/trace-summary-projection.port";
export {
  TraceSpanContentDropPort,
  type TraceSpanContentDropResult,
  TraceSpanCostEnrichmentPort,
  TraceSpanPiiRedactionPort,
  TraceSpanTokenEstimationPort,
} from "./ports/trace-span-preparation.port";
export { TraceSpanSpoolPort, type TraceSpanSpoolIdentity } from "./ports/trace-span-spool.port";
export { TraceSpanNormalizationPort } from "./ports/trace-span-normalization.port";
export { TraceSpanStoragePort } from "./ports/trace-span-storage.port";
export { ClickHouseTraceSpanStorageAdapter } from "./adapters/clickhouse.trace-span-storage.adapter";
export { TraceStoredSpanReaderPort } from "./ports/trace-stored-span-reader.port";
export { TraceDerivationSpanReaderPort } from "./ports/trace-derivation-span-reader.port";
export { ClickHouseTraceDerivationSpanReaderAdapter } from "./adapters/clickhouse.trace-derivation-span-reader.adapter";
export { TraceEventDerivationService } from "./services/trace-event-derivation.service";
export {
  ScenarioRoleMetricsDerivationService,
  type ScenarioRoleMetricsDerivationInput,
} from "./services/scenario-role-metrics-derivation.service";
export { TraceSpanCollectionService } from "./services/trace-ingestion.service";
export { TrackedEventSpanService } from "./services/tracked-event-span.service";
export {
  ClickHouseTraceProjectionStorageAdapter,
  type ClickHouseTraceProjectionStorageOptions,
} from "./adapters/clickhouse.trace-projection-storage.adapter";
export { ClickHouseTraceStoredSpanReaderAdapter } from "./adapters/clickhouse.trace-stored-span-reader.adapter";
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
  MAX_PROCESSED_SPANS,
  TraceSummaryFoldProjection,
} from "./projections/trace-summary.projection";
export {
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT,
  type TraceAnalyticsData,
  TraceAnalyticsFoldProjection,
  type TraceAnalyticsRow,
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
  type SpanDedupRef,
} from "./services/trace-ingestion.service";
export {
  DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES,
  TraceAttributeCap,
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
export { TraceAttributeExtractionService } from "./services/trace-attribute-extraction.service";
export { TraceOriginService } from "./services/trace-origin.service";
export { TraceIOAccumulationService } from "./services/trace-io-accumulation.service";
export { TraceLogRecordIOService } from "./services/trace-log-record-io.service";

export { SpanTimingService } from "./services/span-timing.service";

export { TraceProjectionRuntimeService } from "./services/trace-projection-runtime.service";
export {
  IO_ATTR_KEYS,
  IO_PREVIEW_BYTES,
  leanForProjection,
  structuredIoPreview,
  utf8Preview,
} from "./services/trace-projection-lean.service";
export { leanReplayEvent } from "./adapters/eventing.trace-projection-lean.adapter";
export { TraceIoExtractionAdapter } from "./adapters/trace-io-extraction.adapter";
export { TraceSpanNormalizationAdapter } from "./adapters/trace-span-normalization.adapter";
export { TraceMediaReferenceAdapter } from "./adapters/trace-media-reference.adapter";
export { ModelCatalogTraceModelCostAdapter } from "./adapters/model-catalog.trace-model-cost.adapter";
export {
  aggregateScenarioRoleMetrics,
  deriveScenarioRoleMetricsFromSpans,
  type ScenarioRoleMetrics,
  type ScenarioRoleSpanInput,
} from "./services/scenario-role-metrics.rules";

export {
  TraceApp,
  type TraceAppDependencies,
  type TraceProjectReader,
  type TraceShareReader,
  type TracesTopicReader,
  type TracesTrpcEmitters,
} from "./app/trace.app";
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
export { TraceAttributeRedactor } from "./services/trace-attribute-redaction.service";
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
export { SpanNormalizationPipelineService } from "./services/span-normalization.service";
export {
  TraceSpoolLegacyObjectPort,
  TraceSpoolStoragePort,
  type TraceSpoolObjectStore,
} from "./ports/trace-spool-storage.port";
export {
  MAX_SPOOL_BYTES,
  SPOOL_REF_V2,
  SpoolDestinationUnsupportedError,
  SpoolStreamTooLargeError,
  TraceSpoolService,
  type TraceSpoolIdentity,
  type TraceSpoolServiceOptions,
} from "./services/trace-spool.service";
export { TraceSpanSpoolAdapter } from "./adapters/trace-span-spool.adapter";
export {
  ClickHouseTracePayloadReaderAdapter,
  TRACE_PAYLOAD_AGGREGATE_TYPE,
} from "./adapters/clickhouse.trace-payload-reader.adapter";
export { TraceTokenCounterPort } from "./ports/trace-token-counter.port";
export {
  OtlpSpanTokenEstimationService,
  type OtlpSpanTokenEstimationServiceDependencies,
} from "./services/span-token-estimation.service";
export { TraceSpanTokenEstimationAdapter } from "./adapters/trace-span-token-estimation.adapter";
export { TraceProjectMetadataPort } from "./ports/trace-project-metadata.port";
export { TraceModelCostCatalogPort } from "./ports/trace-model-cost-catalog.port";
export { TraceEvaluationMonitorPort } from "./ports/trace-evaluation-monitor.port";
export { TraceTenantBroadcastPort } from "./ports/trace-tenant-broadcast.port";
export {
  TraceProductAnalyticsPort,
  type TraceProductEvent,
} from "./ports/trace-product-analytics.port";
export {
  TraceEvaluationLoopMetricsPort,
  type TraceEvaluationLoopBlockReason,
} from "./ports/trace-evaluation-loop-metrics.port";
export {
  EVALUATOR_LOOP_BLOCKED_METRIC_DESCRIPTION,
  EVALUATOR_LOOP_BLOCKED_METRIC_NAME,
  EVALUATOR_LOOP_BLOCKED_REASON_LABEL,
  OtelTraceEvaluationLoopMetricsAdapter,
} from "./adapters/otel.trace-evaluation-loop-metrics.adapter";
export { OtlpSpanCostEnrichmentService } from "./services/span-cost-enrichment.service";
export { TraceSpanCostEnrichmentAdapter } from "./adapters/trace-span-cost-enrichment.adapter";
export { TraceEvaluationDispatchPort } from "./ports/trace-evaluation-dispatch.port";
export {
  createEvaluationTriggerSubscriber,
  detectCausalityLoop,
  type EvaluationTriggerSubscriberDeps,
} from "./subscribers/evaluation-trigger.subscriber";
export { TraceExistencePort } from "./ports/trace-existence.port";
export { ClickHouseTraceExistenceRepository } from "./repositories/clickhouse/trace-existence.repository";
export {
  TraceEditOverlayRepository,
  type TraceEditOverlayRow,
} from "./repositories/prisma/prisma.trace-edit-overlay.repository";
export {
  TraceEditOverlayService,
  type TraceEditIOField,
} from "./services/trace-edit-overlay.service";
export { createTraceProcessingProducerPipeline } from "./adapters/trace-processing-producer.adapter";

// ---------------------------------------------------------------------------
// The ClickHouse trace READ stack
//
// Everything a captured trace passes through between the columns it is stored
// in and the shape a reader is allowed to see: the legacy read and its
// repository, the explorer's list / sessions / spans / summary / log readers,
// the offload resolution behind a full read, the redaction and display passes,
// the coding-agent log join, the AI composer and the reserved-metadata write.
// ---------------------------------------------------------------------------
export {
  ClickHouseTraceService,
  type TraceLegacyFilterConditions,
} from "./repositories/clickhouse/trace-legacy-read.repository";
export {
  TraceService as TraceLegacyReadService,
  type BlobResolutionDeps,
} from "./services/trace-legacy-read.service";
export type {
  AggregationFiltersInput,
  GetAllTracesForProjectInput,
  GetAllTracesForProjectOptions,
  TraceDateField,
  TraceSharedFiltersInput,
} from "./services/trace-legacy-read.types";
export { TraceListService } from "./services/trace-list-read.service";
export { SessionGroupsService } from "./services/trace-session-groups.service";
export { SpanStorageService } from "./services/trace-span-storage-read.service";
export { TraceSummaryService } from "./services/trace-summary-read.service";
export { LogRecordStorageService } from "./services/trace-log-record-read.service";
export {
  NullSpanStorageRepository,
  type SpanStorageRepository,
} from "./repositories/span-storage.repository";
export { SpanStorageClickHouseRepository } from "./repositories/clickhouse/span-storage.repository";
export {
  NullSessionGroupsRepository,
  type SessionGroupsRepository,
} from "./repositories/session-groups.repository";
export { SessionGroupsClickHouseRepository } from "./repositories/clickhouse/session-groups.repository";
export {
  NullLogRecordStorageRepository,
  type LogRecordStorageRepository,
} from "./repositories/log-record-storage.repository";
export { LogRecordStorageClickHouseRepository } from "./repositories/clickhouse/log-record-storage.repository";
export {
  BlobStore,
  type S3ClientResolution,
  type S3ClientResolver,
  type SpoolStorage,
} from "./services/trace-blob-store.service";
export { TraceIOExtractionService } from "./services/trace-io-extraction.service";
export {
  formatSpansDigest,
  langwatchSpanToReadableSpan,
} from "./services/trace-readable-span.service";
export { VisibilityWindowService } from "./services/trace-visibility-window.service";
export { TraceNotFoundError } from "./services/trace-read-error.service";
export { setTraceWindowedReadMetrics } from "./services/trace-windowed-read.service";
export { setTraceCacheRedis, type TraceCacheRedis } from "./services/trace-ttl-cache.service";
export { TraceSpanIngestPort } from "./ports/trace-span-ingest.port";
export {
  traceMetadataUpdateSchema,
  updateTraceMetadata,
  type TraceMetadataUpdate,
} from "./services/trace-metadata-write.service";
export {
  generateTraceAction,
  generateTraceQueryFromPrompt,
  type AiQueryInput,
  type AiQueryModelResolver,
} from "./services/trace-ai-query.service";
export {
  DERIVED_INPUT_ATTR_PREFIX,
  DERIVED_OUTPUT_ATTR_PREFIX,
} from "./services/trace-log-content-derivation.service";
export {
  enrichCodingAgentSpansFromLogs,
  enrichSingleSpanWithClaudeLogContent,
  isCodingAgentShapedSpan,
  mapSummaryRowsToClaudeRefs,
} from "./services/claude-code-log-enrichment.service";
export type { ClaudeSpanRef } from "./services/claude-code-span-enrichment.service";
export {
  applyDerivedTraceEventProtections,
  applySpanProtections,
  extractRedactionsFromAllSpanInputs,
  extractRedactionsFromAllSpanOutputs,
  redactObject,
} from "./services/trace-read-redaction.service";
export { redactPatchForViewer } from "./services/trace-edit-overlay-redaction.service";
export { restoreWithheldEdits } from "./services/trace-edit-overlay-restore.service";
export { CollectorSpanUtils } from "./services/trace-collector-span.service";

// ---------------------------------------------------------------------------
// The OTLP receiver
//
// `POST /api/otel/v1/{traces,logs,metrics}` and the re-dispatcher that serves
// the paths a misconfigured exporter produces. Each signal's collection is a
// port, so a process composes the ones it holds and mounts nothing for the
// rest.
// ---------------------------------------------------------------------------
export {
  classifyTokenType,
  createOtlpIngestRestApp,
  peekCustomerTraceIds,
  type OtlpIngestCredential,
  type OtlpIngestCredentialPort,
  type OtlpIngestErrorReportPort,
  type OtlpIngestIdentity,
  type OtlpIngestNonBillablePort,
  type OtlpIngestProject,
  type OtlpIngestRestPorts,
  type OtlpIngestUsageLimitPort,
  type OtlpLogCollectionOutcome,
  type OtlpLogCollectionPort,
  type OtlpMetricCollectionOutcome,
  type OtlpMetricCollectionPort,
  type OtlpTraceCollectionPort,
} from "./transport/api-rest/otlp-ingest.api";
export { createOtlpPathAliasRestApp } from "./transport/api-rest/otlp-path-alias.api";
export {
  AI_TOOL_ORIGIN_VALUE,
  CODING_AGENT_ORIGIN_VALUE,
  COPILOT_VSCODE_ALLOWED_SCOPES,
  dropForeignScopesForVscodeKey,
  enforceApiKeyIdOnLogRequest,
  enforceApiKeyIdOnMetricRequest,
  enforceApiKeyIdOnTraceRequest,
  originForIngestSourceType,
  PROVENANCE_ATTR_API_KEY_ID,
  PROVENANCE_ATTR_NON_BILLABLE,
  PROVENANCE_ATTR_ORGANIZATION_ID,
  PROVENANCE_ATTR_ORIGIN,
  PROVENANCE_ATTR_SOURCE,
  PROVENANCE_ATTR_TEMPLATE_ID,
  stampIngestKeyProvenanceOnLogRequest,
  stampIngestKeyProvenanceOnMetricRequest,
  stampIngestKeyProvenanceOnTraceRequest,
  type IngestKeyProvenance,
} from "./services/ingest-key-provenance.rules";
export type { TraceRequestCollectionResult } from "./services/trace-ingestion.service";

// ---------------------------------------------------------------------------
// The download half of the trace read
//
// The streaming CSV / JSONL export: the batched read, the two serialisers, the
// evaluation merge every reader shares, and the two refusals the transport
// publishes. `filters` is joined to the analytics schema at the mount; see
// `trace-export.vocabulary.ts`.
// ---------------------------------------------------------------------------
export { TraceExportService, stripCsvHeader } from "./services/trace-export.service";
export {
  exportFormatSchema,
  exportModeSchema,
  exportProgressSchema,
  traceExportRequestShape,
  type ExportFormat,
  type ExportMode,
  type ExportProgress,
  type ExportRequest,
} from "./services/trace-export.vocabulary";
export {
  ExportFailedError,
  ExportUnauthenticatedError,
} from "./services/trace-export-error.service";
export {
  CSV_NEWLINE,
  serializeTracesToFullCsv,
  serializeTracesToSummaryCsv,
} from "./services/trace-export-csv.rules";
export {
  serializeTraceToFullJson,
  serializeTraceToSummaryJson,
} from "./services/trace-export-json.rules";
export { RESERVED_METADATA_KEYS } from "./services/trace-export-columns.rules";
export { enrichTracesWithEvaluations } from "./services/trace-evaluation-enrichment.rules";

/**
 * The EDGE media path: what a span carries inline, lifted into the object
 * store before the span is folded. Was
 * `platform/app/src/server/app-layer/traces/edge-media-extraction.ts` and the
 * four content-part extractors that sat under `server/stored-objects/` — they
 * walk TRACE content parts and media markers, so they belong to this vertical
 * rather than to Stored Objects.
 */
export {
  TRACE_MEDIA_PURPOSE,
  maybeExtractSpanMedia,
  spanCarriesMediaMarkers,
  type EdgeMediaExtractionDeps,
  type EdgeMediaExtractionLogger,
} from "./services/trace-edge-media-extraction.service";
export {
  TraceEdgeMediaTelemetryPort,
  TraceMediaStorePort,
  type TraceEdgeMediaFailOpenReason,
} from "./ports/trace-media-store.port";
export { coerceContentToArray } from "./services/trace-content-array.service";
export { binaryInputPartSchema } from "./services/trace-binary-part.service";
export {
  extractInlineMediaFromEvent,
  processContentPart,
  type ExtractedRef,
} from "./services/trace-content-extraction.service";
export {
  createExtractionBudget,
  extractInlineMediaFromValue,
  type ExtractionBudget,
} from "./services/trace-value-media-extraction.service";

/** The agent-readable rendering of a trace. Was `server/traces/trace-formatting.ts`. */
export {
  formatTraceSummaryDigest,
  generateAsciiTree,
  toLLMModeTrace,
} from "./services/trace-formatting.service";

/** The REST projection compiler. Was `server/traces/projection/**`. */
export { compileProjection } from "./services/trace-projection-compile.service";
export {
  resolveField,
  type FieldProtection,
  type ProjectionSource,
  type ResolvedField,
} from "./services/trace-projection-catalog.service";

// ---------------------------------------------------------------------------
// The trace READ doors and the SDK collector
//
// `POST /api/traces/search` and its three siblings, the five deprecated
// `/api/trace/*` and `/api/thread/*` endpoints, and `POST /api/collector` —
// the door an SDK posts a whole trace to. Each takes what it cannot own as a
// port, so a process mounts the ones its own graph can answer.
// ---------------------------------------------------------------------------
export {
  createTracesRestApp,
  traceSearchBodyExtensions,
  type TraceSearchBody,
  type TracesRestPorts,
  type TracesRestReadPort,
} from "./transport/api-rest/traces.api";
export {
  createTraceLegacyRestApp,
  type TraceLegacyCredential,
  type TraceLegacyCredentialPort,
  type TraceLegacyReadsPort,
  type TraceLegacyRestPorts,
  type TraceLegacySearchFields,
  type TraceLegacySharePort,
} from "./transport/api-rest/trace-legacy.api";
export {
  createCollectorRestApp,
  type CollectorCredential,
  type CollectorCredentialPort,
  type CollectorErrorReportPort,
  type CollectorEvaluationReportPort,
  type CollectorProject,
  type CollectorRestPorts,
  type CollectorSpanIngestPort,
  type CollectorUsageLimitPort,
} from "./transport/api-rest/collector.api";
export {
  projectionRequestSchema,
  type CompiledProjection,
  type CompileProjectionArgs,
  type ProjectionRequest,
} from "./services/trace-projection.types";
export {
  OtelTraceEdgeMediaTelemetryAdapter,
  TRACE_EDGE_MEDIA_FAIL_OPEN_METRIC_NAME,
} from "./adapters/otel.trace-edge-media-telemetry.adapter";
