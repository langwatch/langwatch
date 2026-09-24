import type {
  InstantEvalEstimateWire,
  InstantEvalRunProgress,
  InstantEvalRunReference,
} from "@langwatch/instant-eval-contract";
import { moduleApi } from "@langwatch/kernel/module-api";

import type { ExportProgressEvent } from "./export-progress.trpc.ts";
import type { TraceOtlpIngestApi } from "./otlp-ingest.rest.ts";
import type {
  ClassifyClaudeCallInput,
  ClassifyClaudeCallResult,
  DeriveClaudeResponseContentInput,
  DeriveClaudeResponseContentResult,
} from "./trace-canonicalisation.ts";
import type { RecordCapturedSpanInput } from "./trace-captured-span.commands.ts";
import type { DerivedTraceEvent } from "./trace-derived-event.ts";
import type { TraceEditOverlayDto, TraceEditOverlayPatch } from "./trace-edit-overlay.contract.ts";
import type {
  EvaluationTraceReadInput,
  EvaluationTraceSpan,
  EvaluationTraceEvent,
} from "./trace-evaluation.contract.ts";
import type { TraceExportDownload, TraceExportDownloadInput } from "./trace-export.vocabulary.ts";
import type { Trace, Span, ElasticSearchEvent } from "./trace-format.schemas.ts";
import type {
  TraceFullReadInput,
  TraceFullRecord,
  TraceFullThreadReadInput,
} from "./trace-full-read.contract.ts";
import type { ResolvedInstantEvalRun } from "./trace-instant-eval-chips.ts";
import type { ExplorerInstantEvalRunInput } from "./trace-instant-eval.schemas.ts";
import type { LangWatchQLTraceFilter } from "./trace-langwatch-ql-filter.ts";
import type { TraceDateField } from "./trace-legacy-read.types.ts";
import type { DiscoverResult, FacetValuesResult } from "./trace-list-view.ts";
import type { AssignTopicCommandData } from "./trace-processing.commands.ts";
import type { TraceSummaryData } from "./trace-projection.ts";
import type { TraceQueryEvaluationRun } from "./trace-query-evaluation.types.ts";
import type {
  TraceQueryClassification,
  TraceQueryClassificationInput,
  TraceQueryFieldCatalogueInput,
} from "./trace-query.contract.ts";
import type { TraceLegacyListInput, TracesForProjectResult } from "./trace-read.contract.ts";
import type { TraceRecord } from "./trace-record.ts";
import type {
  ScenarioRoleMetrics,
  ScenarioRoleMetricsInput,
} from "./trace-scenario-role-metrics.ts";
import type { SharedTraceDto } from "./trace-share.schemas.ts";
import type {
  SpanSummaryRow,
  SpanResourceInfo,
  TraceEventRollup,
  TraceLogRecordDto,
  ModelUsageStatsRow,
  ModelSpanSampleRow,
} from "./trace-span-read-model.ts";
import type {
  TraceTopicClusteringCounts,
  TraceTopicClusteringPage,
  TraceTopicClusteringPageInput,
} from "./trace-topic-clustering-read.ts";
import type { SpanDetail, SpanLangwatchSignals } from "./trace-view.contract.ts";
import type { Protections } from "./trace-viewer-protections.contract.ts";
import type {
  SpanTreeDeltaInput,
  SpanTreeInput,
  TraceIngestWaitInput,
  TraceByIdInput,
  TraceDerivedEventsInput,
  TraceSummaryLookupInput,
} from "./trace.queries.ts";
import type { SpanTreeNode, SpanTreePage } from "./trace.ts";

/** A reviewer correction target owned by Trace, shared structurally with Annotation. */
export type TraceSuggestionTarget =
  | Readonly<{ kind: "trace"; field: "input" | "output" }>
  | Readonly<{ kind: "span"; spanId: string; field: "input" | "output" }>;

/** The durable marker projected onto a trace when an annotation is added or removed. */
export type TraceAnnotationMarker = Readonly<{
  tenantId: string;
  traceId: string;
  annotationId: string;
  occurredAt: number;
}>;

export type TraceAnnotationCommands = Readonly<{
  add(input: TraceAnnotationMarker): Promise<void>;
  remove(input: TraceAnnotationMarker): Promise<void>;
}>;

/** Which side of a captured call a messages rendering answers with. */
export type TraceMessagesSide = "both" | "input" | "output";

/** One named span's messages, and whether the trace holds that span at all. */
export interface TraceRenderedSpanMessages {
  readonly isSpanPresent: boolean;
  readonly json: string | null;
}

/**
 * What the install-wide usage report counts here (ADR-156, section 10): the
 * traces and spans ingested, since `since` (epoch ms) where one is given.
 * A span re-ingested before its parts merged counts twice, as written.
 */
export interface TraceUsageCount {
  readonly traces: number;
  readonly spans: number;
}

/** Public Trace operations shared by process peers after boot composition. */
export interface TraceApi extends TraceOtlpIngestApi {
  extractInlineMediaFromEvent(input: {
    event: unknown;
    projectId: string;
    ownerKind: "scenario_run";
    ownerId: string;
    purpose: "scenario_event";
  }): Promise<{ rewrittenEvent: unknown; refs: readonly { id: string }[] }>;
  downloadTraceExport(input: TraceExportDownloadInput): Promise<TraceExportDownload>;
  formatSpansDigest(input: { spans: Span[] }): Promise<string>;
  /**
   * The trace as the LLM-readable span digest, under a token budget. What a
   * reader that is a model gets, where `formatSpansDigest` is unbounded.
   */
  renderReadableTrace(input: { trace: Trace; maxTokens: number }): Promise<string>;
  /**
   * A thread as one markdown transcript, the traces already ordered and cut by
   * the caller. Under `maxTokens` the preamble and both ends survive and a
   * marker names what was dropped, so a cut never reads as a short thread.
   */
  renderThreadTranscript(input: {
    threadKey: string;
    traces: readonly Trace[];
    maxTokens?: number;
  }): Promise<string>;
  /**
   * The trace's chat messages as JSON: `"both"` answers `{input, output}`, a
   * one-sided ask answers a bare array. Null when the trace carries no
   * readable conversation at all, which is a different answer from an empty one.
   */
  renderTraceMessages(input: { trace: Trace; side: TraceMessagesSide }): Promise<string | null>;
  /** One named span's chat messages as JSON, and whether the trace holds it. */
  renderSpanMessages(input: { trace: Trace; spanId: string }): Promise<TraceRenderedSpanMessages>;
  /** The whole trace as one JSON object, spans included. */
  renderTraceJson(input: { trace: Trace }): Promise<string>;
  recordCapturedSpan(input: RecordCapturedSpanInput): Promise<void>;
  resolveIngestWaitTimeout(input: TraceIngestWaitInput): Promise<number>;
  getEvaluationSpans(input: EvaluationTraceReadInput): Promise<EvaluationTraceSpan[]>;
  getEvaluationEvents(input: EvaluationTraceReadInput): Promise<EvaluationTraceEvent[]>;
  /** The canonical trace record, closed under payload-parity review. */
  getById(input: TraceByIdInput): Promise<TraceRecord>;
  getFullRecord(input: TraceFullReadInput): Promise<TraceFullRecord>;
  getFullThread(input: TraceFullThreadReadInput): Promise<TraceFullRecord[]>;
  deriveEvents(input: TraceDerivedEventsInput): Promise<DerivedTraceEvent[]>;
  /** The query-language field catalogue an AI composer's prompt is grounded on. */
  buildQueryFieldCatalogue(input: TraceQueryFieldCatalogueInput): Promise<string>;
  classifyQuery(input: TraceQueryClassificationInput): TraceQueryClassification;
  /** A polling read: absent summaries and disabled projections both read as null. */
  findSummary(input: TraceSummaryLookupInput): Promise<TraceSummaryData | null>;
  listTraces(input: {
    query: TraceLegacyListInput;
    protections: unknown;
    options?: {
      dateField?: TraceDateField;
      downloadMode?: boolean;
      includeSpans?: boolean;
      resolveBlobs?: boolean;
      scrollId?: string | null;
      /** The v1 REST search's compiled query-language filter, ANDed into the read. */
      filterWhere?: { sql: string; params: Record<string, unknown> };
    };
  }): Promise<TracesForProjectResult>;
  findTrace(input: {
    projectId: string;
    traceId: string;
    protections: unknown;
    withEditOverlay?: boolean;
  }): Promise<Trace | undefined>;
  readTracesWithSpans(input: {
    projectId: string;
    traceIds: string[];
    protections: unknown;
    occurredAt?: { from: number; to: number };
    withEditOverlay?: boolean;
  }): Promise<Trace[]>;
  readTracesWithSpansPreview(input: {
    projectId: string;
    traceIds: string[];
    protections: unknown;
    withEditOverlay?: boolean;
  }): Promise<Trace[]>;
  readOrderedSpansForTrace(input: {
    projectId: string;
    traceId: string;
    protections: unknown;
  }): Promise<Span[]>;
  readThreadTraces(input: {
    projectId: string;
    threadId: string;
    protections: unknown;
  }): Promise<Trace[]>;
  /**
   * Every trace of the named threads. `maxTraces` is the ceiling across all of
   * them together: a caller asking for many threads at once sizes it by the
   * threads, because a ceiling below what they hold drops the rest silently.
   */
  readThreadsTraces(input: {
    projectId: string;
    threadIds: string[];
    protections: unknown;
    withEditOverlay?: boolean;
    maxTraces?: number;
  }): Promise<Trace[]>;
  readSampleTraces(input: {
    query: TraceLegacyListInput;
    protections: unknown;
    pageSize: number;
  }): Promise<Trace[]>;
  readForViewer(input: {
    projectId: string;
    userId: string;
    traceIds: readonly string[];
  }): Promise<Trace[]>;
  /** The caller's read-time redactions for one project, resolved from who they are. */
  resolveViewerProtections(input: {
    projectId: string;
    userId: string | null;
  }): Promise<Protections>;
  /**
   * The same redactions for an API-KEY caller: the public branch of every
   * content category, plus the credential's own `cost:view` grant. A legacy
   * project key (`apiKeyId: null`) predates RBAC and sees costs.
   */
  resolveApiKeyProtections(input: {
    projectId: string;
    apiKeyId: string | null;
    userId: string | null;
  }): Promise<Protections>;
  findExistingTraceIds(input: {
    projectId: string;
    traceIds: readonly string[];
  }): Promise<string[]>;
  loadTraces(input: {
    userId: string;
    projectId: string;
    traceIds: readonly string[];
  }): Promise<readonly Trace[]>;
  writeSuggestion(input: {
    projectId: string;
    traceId: string;
    target: TraceSuggestionTarget;
    text: string;
    userId: string;
  }): Promise<void>;
  recordAnnotation(input: TraceAnnotationMarker): Promise<void>;
  removeAnnotation(input: TraceAnnotationMarker): Promise<void>;
  isCodingAgentShapedSpan(span: Span): boolean;
  enrichSpansFromCodingAgentLogs(input: {
    projectId: string;
    traceId: string;
    spans: Span[];
    occurredAtMs?: number;
  }): Promise<Span[]>;
  enrichSpanFromCodingAgentLogs(input: {
    span: Span;
    modelCallRefs: unknown;
    logRows: TraceLogRecordDto[];
  }): Span;
  mapCodingAgentSummaryRows(rows: SpanSummaryRow[]): unknown;
  codingAgentLogContentKeys(eventName: string): readonly {
    key: string;
    category: "input" | "output" | "both";
  }[];
  buildCodingAgentTranscript(input: { spans: SpanDetail[]; logs: TraceLogRecordDto[] }): unknown;
  getLogsByTraceId(
    tenantId: string,
    traceId: string,
    occurredAtMs?: number,
    limit?: number,
  ): Promise<
    readonly {
      spanId: string;
      timeUnixMs: number;
      body: string;
      attributes: Record<string, string>;
      resourceAttributes: Record<string, string>;
      scopeName: string;
      scopeVersion: string | null;
    }[]
  >;
  readSpanSummaries(input: {
    projectId: string;
    traceId: string;
    occurredAtMs?: number;
  }): Promise<SpanSummaryRow[]>;
  readSpans(input: {
    projectId: string;
    traceId: string;
    occurredAtMs?: number;
    visibilityCutoffMs?: number | null;
    limit?: number;
  }): Promise<Span[]>;
  readSpansPage(input: {
    projectId: string;
    traceId: string;
    limit: number;
    offset: number;
    occurredAtMs?: number;
    visibilityCutoffMs?: number | null;
  }): Promise<{ spans: Span[]; total: number }>;
  readSpansSince(input: {
    projectId: string;
    traceId: string;
    sinceStartTimeMs: number;
    occurredAtMs?: number;
    visibilityCutoffMs?: number | null;
  }): Promise<Span[]>;
  findSpan(input: {
    projectId: string;
    traceId: string;
    spanId: string;
    occurredAtMs?: number;
    visibilityCutoffMs?: number | null;
  }): Promise<Span | null>;
  readSpanEvents(input: {
    projectId: string;
    traceId: string;
    spanId: string;
    occurredAtMs?: number;
  }): Promise<ElasticSearchEvent[]>;
  readLangwatchSignals(input: {
    projectId: string;
    traceId: string;
    occurredAtMs?: number;
  }): Promise<{ spanId: string; signals: SpanLangwatchSignals["signals"] }[]>;
  readSpanResources(input: {
    projectId: string;
    traceId: string;
    occurredAtMs?: number;
  }): Promise<SpanResourceInfo[]>;
  readTraceEvents(input: {
    projectId: string;
    traceId: string;
    occurredAtMs?: number;
  }): Promise<DerivedTraceEvent[]>;
  readTraceEventRollups(input: {
    projectId: string;
    traceIds: string[];
    timeRange: { from: number; to: number };
  }): Promise<Record<string, TraceEventRollup>>;
  readSpanTreePage(input: SpanTreeInput): Promise<SpanTreePage>;
  readSpanTreeDelta(input: SpanTreeDeltaInput): Promise<SpanTreeNode[]>;
  readModelUsageStats(input: {
    projectId: string;
    fromMs: number;
    limit: number;
  }): Promise<ModelUsageStatsRow[]>;
  readRecentSpansByModels(input: {
    projectId: string;
    models: string[];
    fromMs: number;
    perModelLimit: number;
    limit: number;
  }): Promise<ModelSpanSampleRow[]>;
  readEvaluations(input: {
    projectId: string;
    traceIds: string[];
    protections: unknown;
  }): Promise<Record<string, unknown[]>>;
  findEvaluationInputs(input: {
    projectId: string;
    evaluationId: string;
  }): Promise<Record<string, unknown> | null>;
  readTopicCounts(input: TraceLegacyListInput): Promise<unknown>;
  readCustomersAndLabels(input: TraceLegacyListInput): Promise<unknown>;
  /**
   * The trace query language's free-text filter, compiled to a parameterized
   * ClickHouse WHERE fragment. Null for an empty query; throws `FilterParseError`
   * on invalid syntax.
   */
  translateTraceFilter(input: {
    query: string;
    tenantId: string;
    timeRange: { from: number; to: number };
    /** The Instant Eval runs registered for the query's `eval` chips. */
    evalRuns?: readonly ResolvedInstantEvalRun[];
  }): { sql: string; params: Record<string, unknown> } | null;
  /**
   * The Explorer's own filter: the query compiled, hidden origins left out
   * unless the query (or `originNamed`) names one; `dateField` refuses a
   * span/event clause on the `updated` axis.
   */
  compileExplorerTraceFilter(input: {
    query: string;
    tenantId: string;
    timeRange: { from: number; to: number };
    evalRuns?: readonly ResolvedInstantEvalRun[];
    originNamed?: boolean;
    dateField?: TraceDateField;
  }): { sql: string; params: Record<string, unknown> };
  /**
   * The filter compiled against the LangWatchQL trace view, for a statement a
   * caller runs; throws `FilterParseError` on syntax the language cannot read.
   */
  compileLangWatchQLTraceFilter(input: { filter: string }): LangWatchQLTraceFilter;
  /**
   * The trace ids a filter selects, newest first and capped: the predicate the
   * Explorer's table shows. What an Instant Eval run started from the Explorer
   * judges when its own dialect cannot compile the filter.
   */
  findTraceIdsForFilter(input: {
    projectId: string;
    filter: string;
    window: { from: number; to: number };
    limit: number;
  }): Promise<readonly string[]>;
  /** The query's positive bare-word terms, for a content (log-body) search. */
  extractTraceFreeTextTerms(query: string): string[];
  readFieldNames(input: {
    projectId: string;
    startDate: number;
    endDate: number;
  }): Promise<unknown>;
  findPromptStudioSpan(input: {
    projectId: string;
    spanId: string;
    protections: unknown;
  }): Promise<unknown>;
  readTopics(input: { projectId: string }): Promise<
    readonly Readonly<{
      id: string;
      name: string;
      parentId: string | null;
    }>[]
  >;
  getTenantEmitter(tenantId: string): NodeJS.EventEmitter;
  cleanupTenantEmitter(tenantId: string): void;
  readTraceList(params: unknown): Promise<unknown>;
  readSessionGroups(params: unknown): Promise<unknown>;
  /**
   * The sidebar's facets under the active query: descriptors counted in the
   * window the list reads, each facet exempt from its own terms (ADR-139).
   */
  readFilteredFacets(input: {
    projectId: string;
    timeRange: { from: number; to: number; live?: boolean };
    query: string;
    evalRuns?: readonly ResolvedInstantEvalRun[];
  }): Promise<unknown>;
  readNewCount(params: unknown): Promise<number>;
  readSuggestions(params: unknown): Promise<string[]>;
  readDiscover(params: {
    tenantId: string;
    timeRange: { from: number; to: number; live?: boolean };
  }): Promise<DiscoverResult>;
  readFacetValues(params: {
    tenantId: string;
    timeRange: { from: number; to: number };
    facetKey: string;
    prefix?: string;
    limit: number;
    offset: number;
  }): Promise<FacetValuesResult>;
  readTraceSummary(input: {
    projectId: string;
    traceId: string;
    occurredAtMs?: number;
    visibilityCutoffMs?: number | null;
    full?: boolean;
  }): Promise<unknown>;
  isTraceWindowRedacted(input: {
    projectId: string;
    traceId: string;
    visibilityCutoffMs: number | null | undefined;
  }): Promise<boolean>;
  readTraceLogRecords(input: {
    projectId: string;
    traceId: string;
    occurredAtMs?: number;
    limit?: number;
  }): Promise<TraceLogRecordDto[]>;
  changeTraceName(
    input: { projectId: string; traceId: string; newName: string; occurredAt?: number },
    by: { id: string },
  ): Promise<unknown>;
  findTraceEditOverlay(input: {
    projectId: string;
    traceId: string;
  }): Promise<TraceEditOverlayDto | null>;
  saveTraceEditOverlay(
    input: { projectId: string; traceId: string; patch: TraceEditOverlayPatch },
    by: { id: string },
  ): Promise<TraceEditOverlayDto>;
  deleteTraceEditOverlay(input: { projectId: string; traceId: string }): Promise<void>;
  readEvaluationRuns(input: { tenantId: string; traceId: string }): Promise<unknown>;
  readCodingAgentSession(input: { projectId: string; traceId: string }): Promise<unknown>;
  /** Main's `codingAgentTranscript`: the transcript through the viewer's own protections. */
  readCodingAgentTranscript(input: {
    projectId: string;
    traceId: string;
    occurredAtMs?: number | undefined;
    viewerUserId: string;
  }): Promise<unknown>;
  /**
   * Main's `GET /api/traces/:traceId/transcript`: the key's protections, the trace by id or
   * prefix, then its transcript.
   */
  readTraceTranscript(input: {
    projectId: string;
    traceId: string;
    apiKeyId: string | null;
    userId: string | null;
  }): Promise<unknown>;
  /** One export's progress frames from the tenant broadcast, ending at `done` or `error`. */
  streamExportProgress(input: {
    projectId: string;
    exportId: string;
    signal?: AbortSignal | undefined;
  }): AsyncGenerator<ExportProgressEvent>;
  resolveShareForViewer(input: {
    token: string;
    viewer: unknown;
    viewerKey?: string;
  }): Promise<unknown>;
  readCachedSharePayload(input: { token: string; protections: unknown }): Promise<unknown>;
  writeCachedSharePayload(input: {
    token: string;
    protections: unknown;
    payload: unknown;
  }): Promise<void>;
  findProject(projectId: string): Promise<unknown>;
  /**
   * The anonymous share page's whole payload for one token (port of main's
   * `sharedTrace.get`, ADR-057). `viewerUserId` is the signed-in caller, if any.
   */
  getSharedTrace(input: {
    token: string;
    viewerUserId: string | null;
    clientIp: string | null;
    userAgent: string | null;
  }): Promise<SharedTraceDto>;

  /**
   * The Explorer's Instant Eval, priced. The shorthand it sends is turned into
   * the statement a CLI caller would write, judging nothing.
   */
  estimateExplorerEvalRun(input: {
    request: ExplorerInstantEvalRunInput;
    userId: string;
  }): Promise<InstantEvalEstimateWire>;
  /** The same shorthand, accepted and queued. Answers the run's counters. */
  startExplorerEvalRun(input: {
    request: ExplorerInstantEvalRunInput;
    userId: string;
  }): Promise<InstantEvalRunProgress>;
  /** Asks a run to stop. A run that already finished is refused by name. */
  cancelExplorerEvalRun(input: {
    projectId: string;
    runId: string;
    requestedByUserId?: string;
  }): Promise<InstantEvalRunProgress>;
  /** One run's counters, which is all a chip and a progress bar read. */
  getExplorerEvalRun(input: { projectId: string; runId: string }): Promise<InstantEvalRunProgress>;
  /**
   * The runs a query's `eval` chips claim, checked against the project and
   * dated for the compiler. A claim the project does not own is dropped, so
   * the chip behind it stays pending and selects no rows.
   */
  findExplorerEvalRuns(input: {
    projectId: string;
    evalRuns?: Readonly<Record<string, InstantEvalRunReference>>;
  }): Promise<readonly ResolvedInstantEvalRun[]>;

  /** The platform's own address for one trace resource, built from the
   * project's slug and the path the caller already resolved. */
  platformUrl(input: { projectSlug: string; path: string }): string;
  /** The usage report's figures (ADR-156, section 10). */
  countUsage(input: { projectIds: readonly string[]; since?: number }): Promise<TraceUsageCount>;
  classifyClaudeCall(input: ClassifyClaudeCallInput): ClassifyClaudeCallResult;
  deriveClaudeResponseContent(
    input: DeriveClaudeResponseContentInput,
  ): DeriveClaudeResponseContentResult;
  /** Sends trace_processing's assignTopic command; refuses where this process registered none. */
  assignTopic(input: AssignTopicCommandData): Promise<void>;
  deriveScenarioRoleMetrics(input: ScenarioRoleMetricsInput): Promise<ScenarioRoleMetrics>;
  /** A saved query against one folded trace, in memory; fails closed on anything it cannot read. */
  matchesFilterQuery(input: {
    query: string;
    foldState: TraceSummaryData;
    evaluations: TraceQueryEvaluationRun[] | null;
    events: DerivedTraceEvent[] | null;
  }): boolean;
  /** A trigger's legacy trace filters against one folded trace; evaluation fields fail closed. */
  matchesTraceFilters(input: {
    filters: Readonly<Record<string, unknown>>;
    foldState: TraceSummaryData;
    events: DerivedTraceEvent[] | null;
  }): boolean;
  readTopicClusteringCounts(input: { projectId: string }): Promise<TraceTopicClusteringCounts>;
  readTopicClusteringPage(input: TraceTopicClusteringPageInput): Promise<TraceTopicClusteringPage>;
  /** This UTC billing month's distinct traces per project; refuses a project foreign to the organization. */
  countTracesByProjects(input: {
    organizationId: string;
    projectIds: string[];
  }): Promise<{ projectId: string; count: number }[]>;
}

export const TraceApi = moduleApi<TraceApi>()("trace");
