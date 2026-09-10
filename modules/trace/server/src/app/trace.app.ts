import type { Protections, TraceEditOverlayPatch } from "@langwatch/trace-contract";
import { on } from "node:events";
import {
  TraceIngestionUnavailableError,
  recordCapturedSpanInputSchema,
  type RecordCapturedSpanInput,
} from "@langwatch/trace-contract";
import type { TraceSpanIngestPort } from "../ports/trace-span-ingest.port.ts";
import { TraceCollectorSpanService } from "../services/span/trace-collector-span.service.ts";
/**
 * The trace feature's application: the one typed thing every door is given, replacing five previously-private bags (SpansApplication, TracesApplication, TraceEditOverlayApplication, SharedTraceApplication, TracesV2Application) that agreed by attention, not construction, and couldn't see each other's declarations. What lives here as a rule rather than a service's own concern: attribution (changeTraceName + reviewer-correction stamp the caller as an argument, not a session read, so one op serves a browser/API-key/job caller alike); full resolution (#4991: a content-consuming read resolves offloads, a listing read stays on preview); the partition-pruning hint (occurredAtMs must be OMITTED, never undefined); the visibility-window verdict; and the sample draw (list ids, then read those traces in full). A door may still shape its own paging/limits/redactions, but not decide privately what the application does.
 */
import type { CodingAgentApi } from "@langwatch/coding-agent-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import { createLogger } from "@langwatch/observability";
import type { ShareViewer, ShareApi } from "@langwatch/share-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { TopicApi } from "@langwatch/topic-contract";
import { TraceApi as TraceApiToken } from "@langwatch/trace-contract";
import type {
  CustomersAndLabelsResult,
  DerivedTraceEvent,
  DiscoverResult,
  ElasticSearchEvent,
  Evaluation,
  DistinctFieldNamesResult,
  FacetValuesResult,
  PromptStudioSpanResult,
  SessionGroupsResult,
  SharedTraceDto,
  Span,
  SpanDetail,
  SpanLangwatchSignals,
  SpanResourceInfo,
  SpanSummaryRow,
  ModelUsageStatsRow,
  ModelSpanSampleRow,
  SpanTreeDeltaInput,
  SpanTreeInput,
  SpanTreeNode,
  SpanTreePage,
  TopicCountsResult,
  Trace,
  TraceIngestWaitInput,
  TraceCanonicalisationService,
  TraceEditOverlayDto,
  TraceEventRollup,
  TraceLegacyFilterInput,
  TraceLegacyListInput,
  TraceListFacetCounts,
  TraceListPage,
  TraceContentReadService,
  TraceViewerService,
  TraceApi,
  TraceAnnotationCommands,
  TraceAnnotationMarker,
  TraceSuggestionTarget,
  TraceSummaryData,
  TracesForProjectResult,
  TraceByIdInput,
  TraceRecord,
  TraceFullReadInput,
  TraceFullRecord,
  TraceFullThreadReadInput,
  TraceDerivedEventsInput,
  TraceQueryFieldCatalogueInput,
  TraceQueryClassification,
  TraceQueryClassificationInput,
  TraceSummaryLookupInput,
} from "@langwatch/trace-contract";
import type { TraceLegacyReadPort } from "../ports/trace-legacy-read.port.ts";
import type { TraceExistencePort } from "../repositories/read/trace-existence.repository.ts";
import type { TraceViewerProtectionService } from "../services/viewer/trace-viewer-protection.service.ts";
import { TraceContentReadServiceImpl } from "../services/content/trace-content-read.service.ts";
import { ClaudeCodeLogEnrichmentService } from "../services/canonicalisers/coding-agent/claude-code-log-enrichment.service.ts";
import type { TraceService as TraceTreeService } from "../services/support/trace.service.ts";
import { nowInstant } from "@langwatch/time";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import type { TraceRepositories } from "../repositories/trace.repositories.ts";
import { traceDependencies, type TraceInfrastructure } from "./trace-composition.types.ts";
import { composeTraceAppDependencies } from "./trace-read.composition.ts";

const logger = createLogger("langwatch:trace:app");

/** Who a write is attributed to. */
export interface TraceCaller {
  readonly id: string;
}

/** One trace-correlated log record as the storage read answers it. */
export type TraceLogRecordReadRow = Readonly<{
  spanId: string;
  timeUnixMs: number;
  body: string;
  attributes: Record<string, string>;
  resourceAttributes: Record<string, string>;
  scopeName: string;
  scopeVersion: string | null;
}>;

/** The list, facet and discover reads behind the grid and its sidebar. */
export type TracesV2ListReader = Readonly<{
  getList(params: {
    tenantId: string;
    timeRange: { from: number; to: number };
    sort: { columnId: string; direction: "asc" | "desc" };
    page?: number;
    pageSize: number;
    cursor?: { sortValue: number; traceId: string };
    filterWhere?: { sql: string; params: Record<string, unknown> };
    visibilityCutoffMs?: number | null;
  }): Promise<TraceListPage>;
  getFacets(params: {
    tenantId: string;
    timeRange: { from: number; to: number };
    filterWhere?: { sql: string; params: Record<string, unknown> };
  }): Promise<TraceListFacetCounts>;
  getNewCount(params: {
    tenantId: string;
    timeRange: { from: number; to: number };
    since: number;
    filterWhere?: { sql: string; params: Record<string, unknown> };
  }): Promise<number>;
  getSuggestions(params: {
    tenantId: string;
    field: string;
    prefix: string;
    limit?: number;
  }): Promise<string[]>;
  getDiscover(params: {
    tenantId: string;
    timeRange: { from: number; to: number };
  }): Promise<DiscoverResult>;
  getFacetValues(params: {
    tenantId: string;
    timeRange: { from: number; to: number };
    facetKey: string;
    prefix?: string;
    limit: number;
    offset: number;
  }): Promise<FacetValuesResult>;
}>;

/** The Sessions lens read. */
export type TracesV2SessionGroupsReader = Readonly<{
  getSessionGroups(params: {
    tenantId: string;
    timeRange: { from: number; to: number; live?: boolean };
    sort?: { columnId: string; direction: "asc" | "desc" };
    pageSize: number;
    cursor?: string;
    filterWhere?: { sql: string; params: Record<string, unknown> };
    contentTerms?: string[];
    visibilityCutoffMs?: number | null;
  }): Promise<SessionGroupsResult>;
}>;

type ByTrace = { tenantId: string; traceId: string; occurredAtMs?: number };

/** Every per-span read the drawer, the waterfall and the share page issue. */
export type TracesV2SpanReader = Readonly<{
  getSpansByTraceId(
    params: ByTrace & { limit?: number; visibilityCutoffMs?: number | null },
  ): Promise<Span[]>;
  tryGetSpanById(
    params: ByTrace & { spanId: string; visibilityCutoffMs?: number | null },
  ): Promise<Span | null>;
  getSpanEvents(params: ByTrace & { spanId: string }): Promise<ElasticSearchEvent[]>;
  getSpansPaginated(
    params: ByTrace & { limit: number; offset: number; visibilityCutoffMs?: number | null },
  ): Promise<{ spans: Span[]; total: number }>;
  getSpansSince(
    params: ByTrace & { sinceStartTimeMs: number; visibilityCutoffMs?: number | null },
  ): Promise<Span[]>;
  getSpanSummaryByTraceId(params: ByTrace): Promise<SpanSummaryRow[]>;
  getLangwatchSignalsByTraceId(
    params: ByTrace,
  ): Promise<Array<{ spanId: string; signals: SpanLangwatchSignals["signals"] }>>;
  getSpanResourcesByTraceId(params: ByTrace): Promise<SpanResourceInfo[]>;
  getTraceEventsByTraceId(params: ByTrace): Promise<DerivedTraceEvent[]>;
  getTraceEventRollupsByTraceIds(params: {
    tenantId: string;
    traceIds: string[];
    timeRange: { from: number; to: number };
  }): Promise<Record<string, TraceEventRollup>>;
  getModelUsageStats(params: {
    tenantId: string;
    fromMs: number;
    limit: number;
  }): Promise<ModelUsageStatsRow[]>;
  getRecentSpansByModels(params: {
    tenantId: string;
    models: string[];
    fromMs: number;
    perModelLimit: number;
    limit: number;
  }): Promise<ModelSpanSampleRow[]>;
}>;

/**
 * The trace's own summary read, in the one shape all three readers need: occurredAtMs prunes partitions, visibilityCutoffMs applies the plan's window, full resolves offloaded values — the union of what the drawer header, correction overlay and share page each declared separately.
 */
export type TraceSummaryReader = Readonly<{
  getByTraceId(
    tenantId: string,
    traceId: string,
    options?: Readonly<{
      occurredAtMs?: number;
      visibilityCutoffMs?: number | null;
      full?: boolean;
    }>,
  ): Promise<TraceSummaryData>;
}>;

/** The trace's log records, as the storage read answers them. */
export type TraceLogRecordReader = Readonly<{
  getLogsByTraceId(
    tenantId: string,
    traceId: string,
    occurredAtMs?: number,
    limit?: number,
  ): Promise<TraceLogRecordReadRow[]>;
}>;

/** The stored reviewer corrections, as this feature reads and writes them. */
export type TraceEditOverlayStore = Readonly<{
  tryGetByTraceId(
    input: Readonly<{ projectId: string; traceId: string }>,
  ): Promise<TraceEditOverlayDto | null>;
  upsert(
    input: Readonly<{
      projectId: string;
      traceId: string;
      patch: unknown;
      userId: string | null;
    }>,
  ): Promise<TraceEditOverlayDto>;
  delete(input: Readonly<{ projectId: string; traceId: string }>): Promise<void>;
  mergeTraceIOEdit(
    input: Readonly<{
      projectId: string;
      traceId: string;
      field: "input" | "output";
      value: string;
      userId: string | null;
    }>,
  ): Promise<TraceEditOverlayDto>;
  tryRemoveTraceIOEdit(
    input: Readonly<{
      projectId: string;
      traceId: string;
      field: "input" | "output";
      userId: string | null;
    }>,
  ): Promise<TraceEditOverlayDto | null>;
  mergeSpanFieldEdit(
    input: Readonly<{
      projectId: string;
      traceId: string;
      spanId: string;
      field: "input" | "output";
      text: string;
      userId: string | null;
    }>,
  ): Promise<TraceEditOverlayDto>;
  tryRemoveSpanFieldEdit(
    input: Readonly<{
      projectId: string;
      traceId: string;
      spanId: string;
      field: "input" | "output";
      userId: string | null;
    }>,
  ): Promise<TraceEditOverlayDto | null>;
}>;

/**
 * The project's topic tree, as the topic-count read names its buckets. Only
 * the three fields the grid renders are declared: which topics exist is the
 * Topic feature's, and this application only labels counts with them.
 */
export type TracesTopicReader = Readonly<{
  getAll(
    input: Readonly<{ projectId: string }>,
  ): Promise<ReadonlyArray<Readonly<{ id: string; name: string; parentId: string | null }>>>;
}>;

/** The read side of the process's broadcast fabric. */
export type TracesTrpcEmitters = Readonly<{
  getTenantEmitter(tenantId: string): NodeJS.EventEmitter;
  cleanupTenantEmitter(tenantId: string): void;
}>;

/** The resolved share, as far as the anonymous trace read needs to know it. */
export type ResolvedShare = Readonly<{
  resourceType: string;
  projectId: string;
  resourceId: string;
}>;

/** Redeeming a share token, and the payload cache keyed by its redactions. */
export type TraceShareReader = Readonly<{
  resolveForViewer(input: {
    token: string;
    viewer: ShareViewer;
    viewerKey?: string;
  }): Promise<ResolvedShare>;
  findCachedPayload(input: { token: string; protections: Protections }): Promise<unknown>;
  cachePayload(input: {
    token: string;
    protections: Protections;
    payload: SharedTraceDto;
  }): Promise<void>;
}>;

/** The project card the share page prints above the trace. */
export type TraceProjectReader = Readonly<{
  tryGetById(projectId: string): Promise<{
    name: string | null;
    slug: string | null;
    language: string | null;
    framework: string | null;
  } | null>;
}>;

/** What the process composes this feature's application from. */
export interface TraceAppDependencies {
  spanIngest?: TraceSpanIngestPort;
  viewer?: TraceViewerService;
  protections?: TraceViewerProtectionService;
  annotationCommands?: TraceAnnotationCommands;
  traces: Readonly<{
    existence: TraceExistencePort;
    /** The legacy trace read the `traces.*` and `spans.*` surfaces call. */
    read: TraceLegacyReadPort;
    list: TracesV2ListReader;
    sessionGroups: TracesV2SessionGroupsReader;
    spans: TracesV2SpanReader;
    summary: TraceSummaryReader;
    tree: TraceTreeService;
    logRecords: TraceLogRecordReader;
    canonicalisation: TraceCanonicalisationService;
    /** Reviewer corrections applied over a captured trace at read time. */
    editOverlay: TraceEditOverlayStore;
    changeTraceName(input: {
      tenantId: string;
      traceId: string;
      newName: string;
      changedByUserId: string;
      occurredAt: number;
    }): Promise<unknown>;
  }>;
  topics: TopicApi;
  broadcast: TracesTrpcEmitters;
  evaluations: EvaluationApi;
  codingAgents: CodingAgentApi;
  share: ShareApi;
  projects: ProjectApi;
}

/**
 * The partition-pruning hint, as a read must receive it: present or absent, never present-and-undefined. Passing the key with no value turns a bounded read into a scan of every weekly partition, cold S3 included — the difference between a 100ms read and a multi-second one.
 */
function occurredAtHint(occurredAtMs?: number): { occurredAtMs: number } | Record<string, never> {
  return occurredAtMs !== undefined ? { occurredAtMs } : {};
}

export class TraceApp implements TraceApi {
  static readonly contract = TraceApiToken;
  static readonly dependencies = traceDependencies;

  static create(
    input:
      | TraceAppDependencies
      | FeatureSetup<typeof traceDependencies, TraceInfrastructure, undefined, TraceRepositories>,
  ): TraceApp {
    const dependencies =
      "infrastructure" in input
        ? composeTraceAppDependencies({
            ...input.infrastructure.trace,
            ...input.dependencies,
            repositories: input.repositories,
            protections: {
              authz: input.dependencies.authz,
              projects: input.dependencies.projects,
              plans: input.dependencies.plans,
              dataPrivacy: input.dependencies.dataPrivacy,
              fallbackVisibilityDays: input.infrastructure.trace.fallbackVisibilityDays,
              processName: input.infrastructure.trace.processName,
            },
          })
        : input;
    return new TraceApp(dependencies);
  }

  #contentReader: TraceContentReadService;
  #dependencies: TraceAppDependencies;
  private constructor(dependencies: TraceAppDependencies) {
    this.#dependencies = dependencies;
    this.#contentReader = TraceContentReadServiceImpl.create(dependencies.traces.read);
  }

  resolveIngestWaitTimeout(input: TraceIngestWaitInput) {
    return this.#dependencies.traces.tree.resolveIngestWaitTimeout(input);
  }

  async recordCapturedSpan(input: RecordCapturedSpanInput): Promise<void> {
    const parsed = recordCapturedSpanInputSchema.parse(input);
    const ingest = this.#dependencies.spanIngest;
    if (!ingest) {
      throw new TraceIngestionUnavailableError();
    }
    await ingest.recordSpan({
      tenantId: parsed.projectId,
      span: TraceCollectorSpanService.convertSpanToOtlp(parsed.span),
      resource: TraceCollectorSpanService.buildResource({
        reservedTraceMetadata: { user_id: parsed.userId },
        customMetadata: parsed.customMetadata,
      }),
      instrumentationScope: null,
      occurredAt: parsed.occurredAt,
    });
  }

  getEvaluationSpans(input: import("@langwatch/trace-contract").EvaluationTraceReadInput) {
    return this.#dependencies.traces.tree.getEvaluationSpans(input);
  }

  getEvaluationEvents(input: import("@langwatch/trace-contract").EvaluationTraceReadInput) {
    return this.#dependencies.traces.tree.getEvaluationEvents(input);
  }

  listTraces(input: Parameters<TraceContentReadService["listTraces"]>[0]) {
    return this.#contentReader.listTraces(input);
  }
  readTrace(input: Parameters<TraceContentReadService["readTrace"]>[0]) {
    return this.#contentReader.readTrace(input);
  }
  readTracesWithSpans(input: Parameters<TraceContentReadService["readTracesWithSpans"]>[0]) {
    return this.#contentReader.readTracesWithSpans(input);
  }
  readTracesWithSpansPreview(
    input: Parameters<TraceContentReadService["readTracesWithSpansPreview"]>[0],
  ) {
    return this.#contentReader.readTracesWithSpansPreview(input);
  }
  readOrderedSpansForTrace(
    input: Parameters<TraceContentReadService["readOrderedSpansForTrace"]>[0],
  ) {
    return this.#contentReader.readOrderedSpansForTrace(input);
  }
  readThreadTraces(input: Parameters<TraceContentReadService["readThreadTraces"]>[0]) {
    return this.#contentReader.readThreadTraces(input);
  }
  readThreadsTraces(input: Parameters<TraceContentReadService["readThreadsTraces"]>[0]) {
    return this.#contentReader.readThreadsTraces(input);
  }
  readSampleTraces(input: Parameters<TraceContentReadService["readSampleTraces"]>[0]) {
    return this.#contentReader.readSampleTraces(input);
  }
  readForViewer(input: Parameters<TraceViewerService["readForViewer"]>[0]) {
    if (!this.#dependencies.viewer) throw new Error("Trace viewer service is unavailable");
    return this.#dependencies.viewer.readForViewer(input);
  }

  resolveViewerProtections(input: { projectId: string; userId: string | null }): Promise<Protections> {
    if (!this.#dependencies.protections) throw new Error("Trace protections service is unavailable");
    return this.#dependencies.protections.resolve({
      projectId: input.projectId,
      userId: input.userId ?? void 0,
      publiclyShared: false,
    });
  }

  findExistingTraceIds(input: {
    projectId: string;
    traceIds: readonly string[];
  }): Promise<string[]> {
    return this.#dependencies.traces.existence.findExistingTraceIds(input);
  }

  loadTraces(input: {
    userId: string;
    projectId: string;
    traceIds: readonly string[];
  }): Promise<ReadonlyArray<Trace>> {
    return this.readForViewer(input);
  }

  async writeSuggestion(input: {
    projectId: string;
    traceId: string;
    target: TraceSuggestionTarget;
    text: string;
    userId: string;
  }): Promise<void> {
    const { projectId, traceId, target, text, userId } = input;
    const withdrawn = text.length === 0;
    if (target.kind === "span") {
      const span = { projectId, traceId, spanId: target.spanId, userId };
      if (withdrawn) {
        await this.#dependencies.traces.editOverlay.tryRemoveSpanFieldEdit({
          ...span,
          field: target.field,
        });
      } else {
        await this.#dependencies.traces.editOverlay.mergeSpanFieldEdit({
          ...span,
          field: target.field,
          text,
        });
      }
      return;
    }

    const trace = { projectId, traceId, field: target.field, userId };
    if (withdrawn) {
      await this.#dependencies.traces.editOverlay.tryRemoveTraceIOEdit(trace);
    } else {
      await this.#dependencies.traces.editOverlay.mergeTraceIOEdit({
        ...trace,
        value: text,
      });
    }
  }

  recordAnnotation(input: TraceAnnotationMarker): Promise<void> {
    if (!this.#dependencies.annotationCommands) {
      return Promise.reject(new Error("Trace annotation commands are unavailable"));
    }
    return this.#dependencies.annotationCommands.add(input);
  }

  removeAnnotation(input: TraceAnnotationMarker): Promise<void> {
    if (!this.#dependencies.annotationCommands) {
      return Promise.reject(new Error("Trace annotation commands are unavailable"));
    }
    return this.#dependencies.annotationCommands.remove(input);
  }

  // Collaborators handed to a process port as VALUES: the coding-agent log
  // join reads the trace's logs itself and canonicalises per span, so it
  // takes these three as objects, not call results. Exposed rather than
  // wrapped since the join's port type is declared by the transport, and
  // an application importing its own transport would invert the layout.

  /** The trace-log read the coding-agent join issues for itself. */
  getLogsByTraceId(
    tenantId: string,
    traceId: string,
    occurredAtMs?: number,
    limit?: number,
  ): Promise<TraceLogRecordReadRow[]> {
    return this.readTraceLogRecords({
      projectId: tenantId,
      traceId,
      occurredAtMs,
      limit,
    });
  }

  /** The canonicaliser the coding-agent join runs over joined span content. */
  isCodingAgentShapedSpan(span: Span): boolean {
    return ClaudeCodeLogEnrichmentService.isCodingAgentShapedSpan(span);
  }

  enrichSpansFromCodingAgentLogs(input: {
    projectId: string;
    traceId: string;
    spans: Span[];
    occurredAtMs?: number;
  }): Promise<Span[]> {
    return ClaudeCodeLogEnrichmentService.enrichCodingAgentSpansFromLogs({
      logRecords: this,
      tenantId: input.projectId,
      traceId: input.traceId,
      spans: input.spans,
      ...(input.occurredAtMs !== undefined ? { occurredAtMs: input.occurredAtMs } : {}),
      logger,
      traceCanonicalisation: this.#dependencies.traces.canonicalisation,
      codingAgents: this.#dependencies.codingAgents,
    });
  }

  enrichSpanFromCodingAgentLogs(input: {
    span: Span;
    modelCallRefs: unknown;
    logRows: TraceLogRecordReadRow[];
  }): Span {
    return ClaudeCodeLogEnrichmentService.enrichSingleSpanWithClaudeLogContent({
      span: input.span,
      modelCallRefs: input.modelCallRefs as Parameters<
        typeof ClaudeCodeLogEnrichmentService.enrichSingleSpanWithClaudeLogContent
      >[0]["modelCallRefs"],
      logRows: input.logRows,
      traceCanonicalisation: this.#dependencies.traces.canonicalisation,
      codingAgents: this.#dependencies.codingAgents,
    });
  }

  mapCodingAgentSummaryRows(rows: SpanSummaryRow[]): unknown {
    return ClaudeCodeLogEnrichmentService.mapSummaryRowsToClaudeRefs(rows);
  }

  codingAgentLogContentKeys(eventName: string): readonly {
    key: string;
    category: "input" | "output" | "both";
  }[] {
    return this.#dependencies.codingAgents.logContentKeys(eventName);
  }

  buildCodingAgentTranscript(input: {
    spans: SpanDetail[];
    logs: TraceLogRecordReadRow[];
  }): unknown {
    return this.#dependencies.codingAgents.buildTranscript({
      spans: input.spans,
      logs: input.logs.map((row) => ({
        timestampMs: row.timeUnixMs,
        attributes: row.attributes,
        serviceName: row.resourceAttributes["service.name"] ?? null,
      })),
    });
  }

  // Legacy content reads live on the cohesive content service.

  /** The evaluator verdicts on a page of traces, keyed by trace id. */
  readEvaluations(input: {
    projectId: string;
    traceIds: string[];
    protections: unknown;
  }): Promise<Record<string, Evaluation[]>> {
    return this.#dependencies.traces.read.getEvaluationsMultiple(
      input.projectId,
      input.traceIds,
      input.protections,
    );
  }

  /** One evaluation's inputs, resolved lazily when its card is expanded. */
  readEvaluationInputs(input: {
    projectId: string;
    evaluationId: string;
  }): Promise<Record<string, unknown> | null> {
    return this.#dependencies.traces.read.tryGetEvaluationInputs(input);
  }

  /** Topic and subtopic counts for the filtered window. */
  readTopicCounts(input: TraceLegacyFilterInput): Promise<TopicCountsResult> {
    return this.#dependencies.traces.read.getTopicCounts(input);
  }

  /** The distinct customer ids and labels in the filtered window. */
  readCustomersAndLabels(input: TraceLegacyFilterInput): Promise<CustomersAndLabelsResult> {
    return this.#dependencies.traces.read.getCustomersAndLabels(input);
  }

  /** Span names, metadata keys and evaluator names the project has produced. */
  readFieldNames(input: {
    projectId: string;
    startDate: number;
    endDate: number;
  }): Promise<DistinctFieldNamesResult> {
    return this.#dependencies.traces.read.getDistinctFieldNames(
      input.projectId,
      input.startDate,
      input.endDate,
    );
  }

  /** One LLM span reshaped for the prompt studio, or null when it is not one. */
  readPromptStudioSpan(input: {
    projectId: string;
    spanId: string;
    protections: unknown;
  }): Promise<PromptStudioSpanResult | null> {
    return this.#dependencies.traces.read.tryGetSpanForPromptStudio(input);
  }

  // -------------------------------------------------------------------------
  // The project's topics, as the topic-count read labels its buckets
  // -------------------------------------------------------------------------

  /** The project's topic tree. */
  readTopics(
    input: Readonly<{ projectId: string }>,
  ): Promise<ReadonlyArray<Readonly<{ id: string; name: string; parentId: string | null }>>> {
    return this.#dependencies.topics.getAll(input);
  }

  // -------------------------------------------------------------------------
  // The process's broadcast fabric
  // -------------------------------------------------------------------------

  async *streamUpdates(input: {
    projectId: string;
    channel: "trace_updated" | "discover_updated";
    signal?: unknown;
  }): AsyncGenerator<unknown> {
    const emitter = this.#dependencies.broadcast.getTenantEmitter(input.projectId);

    try {
      for await (const eventArgs of on(emitter, input.channel, {
        signal: input.signal as AbortSignal | undefined,
      })) {
        yield eventArgs[0];
      }
    } finally {
      this.#dependencies.broadcast.cleanupTenantEmitter(input.projectId);
    }
  }

  // -------------------------------------------------------------------------
  // The explorer's list, facet and session reads
  // -------------------------------------------------------------------------

  /** One page of the trace grid. */
  readTraceList(params: Parameters<TracesV2ListReader["getList"]>[0]): Promise<TraceListPage> {
    return this.#dependencies.traces.list.getList(params);
  }

  /** One page of the Sessions lens. */
  readSessionGroups(
    params: Parameters<TracesV2SessionGroupsReader["getSessionGroups"]>[0],
  ): Promise<SessionGroupsResult> {
    return this.#dependencies.traces.sessionGroups.getSessionGroups(params);
  }

  /** The filter sidebar's counts. */
  readFacets(
    params: Parameters<TracesV2ListReader["getFacets"]>[0],
  ): Promise<TraceListFacetCounts> {
    return this.#dependencies.traces.list.getFacets(params);
  }

  /** How many traces have arrived since the grid last painted. */
  readNewCount(params: Parameters<TracesV2ListReader["getNewCount"]>[0]): Promise<number> {
    return this.#dependencies.traces.list.getNewCount(params);
  }

  /** The typeahead's values for one field. */
  readSuggestions(params: Parameters<TracesV2ListReader["getSuggestions"]>[0]): Promise<string[]> {
    return this.#dependencies.traces.list.getSuggestions(params);
  }

  /** The facet payload the sidebar opens with. */
  readDiscover(params: Parameters<TracesV2ListReader["getDiscover"]>[0]): Promise<DiscoverResult> {
    return this.#dependencies.traces.list.getDiscover(params);
  }

  /** One facet's values, paged. */
  readFacetValues(
    params: Parameters<TracesV2ListReader["getFacetValues"]>[0],
  ): Promise<FacetValuesResult> {
    return this.#dependencies.traces.list.getFacetValues(params);
  }

  // -------------------------------------------------------------------------
  // The trace's summary
  // -------------------------------------------------------------------------

  /** One trace's summary fold. */
  readTraceSummary(input: {
    projectId: string;
    traceId: string;
    occurredAtMs?: number;
    visibilityCutoffMs?: number | null;
    full?: boolean;
  }): Promise<TraceSummaryData> {
    return this.#dependencies.traces.summary.getByTraceId(input.projectId, input.traceId, {
      ...occurredAtHint(input.occurredAtMs),
      ...(input.visibilityCutoffMs !== undefined
        ? { visibilityCutoffMs: input.visibilityCutoffMs }
        : {}),
      ...(input.full !== undefined ? { full: input.full } : {}),
    });
  }

  /**
   * Whether the plan's visibility window teases this trace's content. Only free plans have a window, so a plan without one answers without reading anything; with one, the trace's own summary decides it — the same read the drawer header makes, keeping the two from disagreeing. A summary that can't be read answers "teased": a correction quotes captured content, so an age we can't establish must not open it — logged, and closed.
   */
  async isTraceWindowRedacted(input: {
    projectId: string;
    traceId: string;
    visibilityCutoffMs: number | null | undefined;
  }): Promise<boolean> {
    if (input.visibilityCutoffMs === null || input.visibilityCutoffMs === undefined) {
      return false;
    }
    try {
      const summary = await this.readTraceSummary({
        projectId: input.projectId,
        traceId: input.traceId,
        visibilityCutoffMs: input.visibilityCutoffMs,
        full: false,
      });
      return summary.redactedByVisibilityWindow === true;
    } catch (error) {
      logger.warn(
        { error, projectId: input.projectId, traceId: input.traceId },
        "trace summary unreadable; withholding corrected content",
      );
      return true;
    }
  }

  // -------------------------------------------------------------------------
  // The trace's spans
  // -------------------------------------------------------------------------

  /** The light per-span summary rows the waterfall is built from. */
  readSpanSummaries(input: {
    projectId: string;
    traceId: string;
    occurredAtMs?: number;
  }): Promise<SpanSummaryRow[]> {
    return this.#dependencies.traces.spans.getSpanSummaryByTraceId({
      tenantId: input.projectId,
      traceId: input.traceId,
      ...occurredAtHint(input.occurredAtMs),
    });
  }

  /** Every stored span of one trace. */
  readSpans(input: {
    projectId: string;
    traceId: string;
    occurredAtMs?: number;
    visibilityCutoffMs?: number | null;
    limit?: number;
  }): Promise<Span[]> {
    return this.#dependencies.traces.spans.getSpansByTraceId({
      tenantId: input.projectId,
      traceId: input.traceId,
      ...(input.visibilityCutoffMs !== undefined
        ? { visibilityCutoffMs: input.visibilityCutoffMs }
        : {}),
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
      ...occurredAtHint(input.occurredAtMs),
    });
  }

  /** One page of a trace's spans. */
  readSpansPage(input: {
    projectId: string;
    traceId: string;
    limit: number;
    offset: number;
    occurredAtMs?: number;
    visibilityCutoffMs?: number | null;
  }): Promise<{ spans: Span[]; total: number }> {
    return this.#dependencies.traces.spans.getSpansPaginated({
      tenantId: input.projectId,
      traceId: input.traceId,
      limit: input.limit,
      offset: input.offset,
      ...(input.visibilityCutoffMs !== undefined
        ? { visibilityCutoffMs: input.visibilityCutoffMs }
        : {}),
      ...occurredAtHint(input.occurredAtMs),
    });
  }

  /** The spans of a live trace that have moved since the browser last looked. */
  readSpansSince(input: {
    projectId: string;
    traceId: string;
    sinceStartTimeMs: number;
    occurredAtMs?: number;
    visibilityCutoffMs?: number | null;
  }): Promise<Span[]> {
    return this.#dependencies.traces.spans.getSpansSince({
      tenantId: input.projectId,
      traceId: input.traceId,
      sinceStartTimeMs: input.sinceStartTimeMs,
      ...(input.visibilityCutoffMs !== undefined
        ? { visibilityCutoffMs: input.visibilityCutoffMs }
        : {}),
      ...occurredAtHint(input.occurredAtMs),
    });
  }

  /** One span, by id. */
  readSpan(input: {
    projectId: string;
    traceId: string;
    spanId: string;
    occurredAtMs?: number;
    visibilityCutoffMs?: number | null;
  }): Promise<Span | null> {
    return this.#dependencies.traces.spans.tryGetSpanById({
      tenantId: input.projectId,
      traceId: input.traceId,
      spanId: input.spanId,
      ...(input.visibilityCutoffMs !== undefined
        ? { visibilityCutoffMs: input.visibilityCutoffMs }
        : {}),
      ...occurredAtHint(input.occurredAtMs),
    });
  }

  /** One span's events. */
  readSpanEvents(input: {
    projectId: string;
    traceId: string;
    spanId: string;
    occurredAtMs?: number;
  }): Promise<ElasticSearchEvent[]> {
    return this.#dependencies.traces.spans.getSpanEvents({
      tenantId: input.projectId,
      traceId: input.traceId,
      spanId: input.spanId,
      ...occurredAtHint(input.occurredAtMs),
    });
  }

  /** The per-span LangWatch instrumentation signals the badges render. */
  readLangwatchSignals(input: {
    projectId: string;
    traceId: string;
    occurredAtMs?: number;
  }): Promise<Array<{ spanId: string; signals: SpanLangwatchSignals["signals"] }>> {
    return this.#dependencies.traces.spans.getLangwatchSignalsByTraceId({
      tenantId: input.projectId,
      traceId: input.traceId,
      ...occurredAtHint(input.occurredAtMs),
    });
  }

  /** The per-span resource and scope rows the resource pane is built from. */
  readSpanResources(input: {
    projectId: string;
    traceId: string;
    occurredAtMs?: number;
  }): Promise<SpanResourceInfo[]> {
    return this.#dependencies.traces.spans.getSpanResourcesByTraceId({
      tenantId: input.projectId,
      traceId: input.traceId,
      ...occurredAtHint(input.occurredAtMs),
    });
  }

  /** The trace-level events the drawer timeline renders. */
  readTraceEvents(input: {
    projectId: string;
    traceId: string;
    occurredAtMs?: number;
  }): Promise<DerivedTraceEvent[]> {
    return this.#dependencies.traces.spans.getTraceEventsByTraceId({
      tenantId: input.projectId,
      traceId: input.traceId,
      ...occurredAtHint(input.occurredAtMs),
    });
  }

  /** The events column's rollups for one page of the grid. */
  readTraceEventRollups(input: {
    projectId: string;
    traceIds: string[];
    timeRange: { from: number; to: number };
  }): Promise<Record<string, TraceEventRollup>> {
    return this.#dependencies.traces.spans.getTraceEventRollupsByTraceIds({
      tenantId: input.projectId,
      traceIds: input.traceIds,
      timeRange: input.timeRange,
    });
  }

  // -------------------------------------------------------------------------
  // The span tree
  // -------------------------------------------------------------------------

  /** One page of the span tree, in `(startTimeMs, spanId)` order. */
  readSpanTreePage(input: SpanTreeInput): Promise<SpanTreePage> {
    return this.#dependencies.traces.tree.getSpanTreePage(input);
  }

  /** The tree nodes of a live trace whose row version is newer than a mark. */
  readSpanTreeDelta(input: SpanTreeDeltaInput): Promise<SpanTreeNode[]> {
    return this.#dependencies.traces.tree.getSpanTreeDelta(input);
  }

  /** The canonical trace record, closed under payload-parity review. */
  getById(input: TraceByIdInput): Promise<TraceRecord> {
    return this.#dependencies.traces.tree.getById(input);
  }

  getFullRecord(input: TraceFullReadInput): Promise<TraceFullRecord> {
    return this.#dependencies.traces.tree.getFullRecord(input);
  }

  getFullThread(input: TraceFullThreadReadInput): Promise<TraceFullRecord[]> {
    return this.#dependencies.traces.tree.getFullThread(input);
  }

  deriveEvents(input: TraceDerivedEventsInput): Promise<DerivedTraceEvent[]> {
    return this.#dependencies.traces.tree.deriveEvents(input);
  }

  /** The query-language field catalogue an AI composer's prompt is grounded on. */
  buildQueryFieldCatalogue(input: TraceQueryFieldCatalogueInput): Promise<string> {
    return this.#dependencies.traces.tree.buildQueryFieldCatalogue(input);
  }

  classifyQuery(input: TraceQueryClassificationInput): TraceQueryClassification {
    return this.#dependencies.traces.tree.classifyQuery(input);
  }

  /** A polling read: absent summaries and disabled projections both read as null. */
  findSummary(input: TraceSummaryLookupInput): Promise<TraceSummaryData | null> {
    return this.#dependencies.traces.tree.tryGetSummary(input);
  }

  readModelUsageStats(input: {
    projectId: string;
    fromMs: number;
    limit: number;
  }): Promise<ModelUsageStatsRow[]> {
    return this.#dependencies.traces.spans.getModelUsageStats({
      tenantId: input.projectId,
      fromMs: input.fromMs,
      limit: input.limit,
    });
  }

  readRecentSpansByModels(input: {
    projectId: string;
    models: string[];
    fromMs: number;
    perModelLimit: number;
    limit: number;
  }): Promise<ModelSpanSampleRow[]> {
    return this.#dependencies.traces.spans.getRecentSpansByModels({
      tenantId: input.projectId,
      models: input.models,
      fromMs: input.fromMs,
      perModelLimit: input.perModelLimit,
      limit: input.limit,
    });
  }

  // -------------------------------------------------------------------------
  // The trace's log records
  // -------------------------------------------------------------------------

  /** Every log record correlated to one trace. */
  readTraceLogRecords(input: {
    projectId: string;
    traceId: string;
    occurredAtMs?: number;
    limit?: number;
  }): Promise<TraceLogRecordReadRow[]> {
    return this.#dependencies.traces.logRecords.getLogsByTraceId(
      input.projectId,
      input.traceId,
      input.occurredAtMs,
      input.limit,
    );
  }

  // -------------------------------------------------------------------------
  // The two things a reader may change about a trace
  // -------------------------------------------------------------------------

  /**
   * Renames a trace, attributed to the caller who asked for it. Attribution lives here, not the door, because "who renamed this" is a property of the act, not the transport it arrived over. The name itself is validated before it gets here; an invalid one is the door's rejection to report.
   */
  changeTraceName(
    input: { projectId: string; traceId: string; newName: string; occurredAt?: number },
    by: TraceCaller,
  ): Promise<unknown> {
    return this.#dependencies.traces.changeTraceName({
      tenantId: input.projectId,
      traceId: input.traceId,
      newName: input.newName,
      changedByUserId: by.id,
      occurredAt: input.occurredAt ?? nowInstant().epochMilliseconds,
    });
  }

  /** The correction stored on a trace, before any reader-specific redaction. */
  readTraceEditOverlay(input: {
    projectId: string;
    traceId: string;
  }): Promise<TraceEditOverlayDto | null> {
    return this.#dependencies.traces.editOverlay.tryGetByTraceId({
      projectId: input.projectId,
      traceId: input.traceId,
    });
  }

  /**
   * Saves the correction, attributed to the caller who asked for it. The door used to stamp the reviewer twice — once on a trace's first correction, once on every replacement — two chances to stamp it differently or not at all.
   */
  saveTraceEditOverlay(
    input: { projectId: string; traceId: string; patch: TraceEditOverlayPatch },
    by: TraceCaller,
  ): Promise<TraceEditOverlayDto> {
    return this.#dependencies.traces.editOverlay.upsert({
      projectId: input.projectId,
      traceId: input.traceId,
      patch: input.patch,
      userId: by.id,
    });
  }

  /** Removes the correction outright. */
  deleteTraceEditOverlay(input: { projectId: string; traceId: string }): Promise<void> {
    return this.#dependencies.traces.editOverlay.delete({
      projectId: input.projectId,
      traceId: input.traceId,
    });
  }

  // -------------------------------------------------------------------------
  // What other verticals answer about a trace
  // -------------------------------------------------------------------------

  /** The evaluation runs recorded against one trace. */
  readEvaluationRuns(
    input: Parameters<EvaluationApi["findRunsByTraceId"]>[0],
  ): ReturnType<EvaluationApi["findRunsByTraceId"]> {
    return this.#dependencies.evaluations.findRunsByTraceId(input);
  }

  /** The pre-folded coding-agent session rollup for one trace, or null. */
  readCodingAgentSession(
    input: Parameters<CodingAgentApi["findSessionForTrace"]>[0],
  ): ReturnType<CodingAgentApi["findSessionForTrace"]> {
    return this.#dependencies.codingAgents.findSessionForTrace(input);
  }

  // -------------------------------------------------------------------------
  // The anonymous share read
  // -------------------------------------------------------------------------

  /**
   * Redeems a share token for one viewer. Every resolve consumes one view and
   * enforces expiry, view cap, audience and the sharing kill switch.
   */
  resolveShareForViewer(input: {
    token: string;
    viewer: ShareViewer;
    viewerKey?: string;
  }): Promise<ResolvedShare> {
    return this.#dependencies.share.resolveForViewer(input);
  }

  /** The cached share payload for this token AND these redactions, if any. */
  readCachedSharePayload(input: { token: string; protections: Protections }): Promise<unknown> {
    return this.#dependencies.share.findCachedPayload(input);
  }

  /** Caches the share payload against this token and these redactions. */
  writeCachedSharePayload(input: {
    token: string;
    protections: Protections;
    payload: SharedTraceDto;
  }): Promise<void> {
    return this.#dependencies.share.cachePayload(input);
  }

  /** The project card the share page prints above the trace. */
  readProject(projectId: string): Promise<{
    name: string | null;
    slug: string | null;
    language: string | null;
    framework: string | null;
  } | null> {
    return this.#dependencies.projects.tryGetById(projectId);
  }
}
