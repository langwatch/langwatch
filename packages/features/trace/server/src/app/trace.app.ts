/**
 * The trace feature's application: what all five of its doors call.
 *
 * It holds every service and port the feature's api modules reach, and it is
 * the one typed thing a transport is given. Before it, each door declared its
 * own private bag — `SpansApplication`, `TracesApplication`,
 * `TraceEditOverlayApplication`, `SharedTraceApplication`,
 * `TracesV2Application` — five descriptions of one application, agreeing by
 * attention rather than by construction, and none of them reachable from
 * another. The anonymous share read and the authenticated explorer issue the
 * SAME five span reads; they could not see each other's declaration of them.
 *
 * Most operations are a service's own, reached through {@link dependencies}.
 * What lives here as a rule is what a door would otherwise have to know:
 *
 *   - **Attribution.** `changeTraceName` and the reviewer-correction write both
 *     stamp the caller who asked for them. Three copies of one rule became one,
 *     and the caller arrives as an argument rather than being read off a
 *     session, which is what lets one operation serve a browser session, an API
 *     key and a background job without knowing which it is serving.
 *   - **Full resolution (#4991).** A read that CONSUMES trace content resolves
 *     offloaded values in full; a read that merely lists it stays on the stored
 *     preview. That was six `{ full: true }` literals across two doors.
 *   - **The partition-pruning hint.** `occurredAtMs` must be OMITTED, never
 *     passed as `undefined`, or the read loses its partition pruning. Fourteen
 *     conditional spreads became one per read.
 *   - **The visibility-window verdict.** Whether the plan's window teases a
 *     trace, and the fail-closed answer when its summary cannot be read.
 *   - **The sample draw.** List for ids, then read those traces in full — the
 *     evaluator wizard and the dataset builder both did it for themselves.
 *
 * A door may still shape what it ASKS for: its own paging, its own limits, its
 * own redactions on the way out. What it may not do is decide, privately, what
 * the application does.
 */
import type { CodingAgentService } from "@langwatch/coding-agent-contract";
import type { EvaluationService } from "@langwatch/evaluation-contract";
import { createLogger } from "@langwatch/observability";
import type { ShareViewer } from "@langwatch/share-contract";
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
  SpanLangwatchSignals,
  SpanResourceInfo,
  SpanSummaryRow,
  SpanTreeDeltaInput,
  SpanTreeInput,
  SpanTreeNode,
  SpanTreePage,
  TopicCountsResult,
  Trace,
  TraceCanonicalisationService,
  TraceEditOverlayDto,
  TraceEventRollup,
  TraceLegacyFilterInput,
  TraceLegacyListInput,
  TraceListFacetCounts,
  TraceListPage,
  TraceService,
  TraceSummaryData,
  TracesForProjectResult,
} from "@langwatch/trace-contract";
import type { TraceLegacyReadPort } from "../ports/trace-legacy-read.port";
import type { Protections } from "../services/trace-viewer-protections.service";

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
  getSpanById(
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
}>;

/**
 * The trace's own summary read, in the one shape all three readers of it need.
 * The union of what the drawer header, the correction overlay and the share
 * page each declared: `occurredAtMs` prunes partitions, `visibilityCutoffMs`
 * applies the plan's window, `full` resolves offloaded values.
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
  getByTraceId(
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
  tryGetCachedPayload(input: { token: string; protections: Protections }): Promise<unknown>;
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
  traces: Readonly<{
    /** The legacy trace read the `traces.*` and `spans.*` surfaces call. */
    read: TraceLegacyReadPort;
    list: TracesV2ListReader;
    sessionGroups: TracesV2SessionGroupsReader;
    spans: TracesV2SpanReader;
    summary: TraceSummaryReader;
    tree: TraceService;
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
  topics: TracesTopicReader;
  broadcast: TracesTrpcEmitters;
  evaluations: EvaluationService;
  codingAgents: CodingAgentService;
  share: TraceShareReader;
  projects: TraceProjectReader;
}

/**
 * The partition-pruning hint, as a read must receive it.
 *
 * Present or absent — never present and `undefined`. Passing the key with no
 * value turns a bounded read into a scan of every weekly partition, cold S3
 * storage included, which is the difference between a 100 ms read and a
 * multi-second one.
 */
function occurredAtHint(occurredAtMs?: number): { occurredAtMs: number } | Record<string, never> {
  return occurredAtMs !== undefined ? { occurredAtMs } : {};
}

export class TraceApp {
  static create(dependencies: TraceAppDependencies): TraceApp {
    return new TraceApp(dependencies);
  }

  private constructor(private readonly dependencies: TraceAppDependencies) {}

  // -------------------------------------------------------------------------
  // Collaborators handed to a process port as VALUES
  //
  // The coding-agent log join reads the trace's logs itself and runs
  // canonicalisation per span, so it takes these three as objects rather than
  // being called with their results. They are exposed rather than wrapped
  // because the join's port type is declared by the transport, and an
  // application importing its own transport would invert the dependency the
  // strict layout exists to hold.
  // -------------------------------------------------------------------------

  /** The trace-log read the coding-agent join issues for itself. */
  get logRecords(): TraceLogRecordReader {
    return this.dependencies.traces.logRecords;
  }

  /** The canonicaliser the coding-agent join runs over joined span content. */
  get canonicalisation(): TraceCanonicalisationService {
    return this.dependencies.traces.canonicalisation;
  }

  /** The coding-agent capability the join and the transcript build both take. */
  get codingAgents(): CodingAgentService {
    return this.dependencies.codingAgents;
  }

  // -------------------------------------------------------------------------
  // The legacy trace read
  // -------------------------------------------------------------------------

  /**
   * The project's list/search read, keyset-paged.
   *
   * Stays on the stored preview: a grid lists content, it does not consume it,
   * and resolving every offloaded value for a page of rows is exactly what
   * #4991 kept off it. The download and the sample draws below, which DO
   * consume the content, ask for it in full.
   */
  listTraces(input: {
    query: TraceLegacyListInput;
    protections: unknown;
    options?: {
      downloadMode?: boolean;
      includeSpans?: boolean;
      resolveBlobs?: boolean;
      scrollId?: string | null;
    };
  }): Promise<TracesForProjectResult> {
    return this.dependencies.traces.read.getAllTracesForProject(
      input.query,
      input.protections,
      input.options,
    );
  }

  /**
   * One trace with its spans, resolved in full.
   *
   * A drawer read consumes the content it shows, so it never serves the 64 KB
   * preview (#4991). Answers `undefined` when the project holds no such trace;
   * turning that into a transport error is the door's business.
   */
  readTrace(input: {
    projectId: string;
    traceId: string;
    protections: unknown;
    withEditOverlay?: boolean;
  }): Promise<Trace | undefined> {
    return this.dependencies.traces.read.getById(input.projectId, input.traceId, input.protections, {
      full: true,
      ...(input.withEditOverlay !== undefined ? { withEditOverlay: input.withEditOverlay } : {}),
    });
  }

  /** Named traces with their spans, resolved in full (#4991). */
  readTracesWithSpans(input: {
    projectId: string;
    traceIds: string[];
    protections: unknown;
    occurredAt?: { from: number; to: number };
    withEditOverlay?: boolean;
  }): Promise<Trace[]> {
    return this.dependencies.traces.read.getTracesWithSpans(
      input.projectId,
      input.traceIds,
      input.protections,
      input.occurredAt,
      {
        full: true,
        ...(input.withEditOverlay !== undefined ? { withEditOverlay: input.withEditOverlay } : {}),
      },
    );
  }

  /**
   * The same traces, on the stored preview.
   *
   * The one read that deliberately does NOT resolve in full: it runs over a
   * whole page of traces at once to render each as a digest, and resolving
   * every offloaded value on all of them is what #4991 kept off the grid.
   */
  readTracesWithSpansPreview(input: {
    projectId: string;
    traceIds: string[];
    protections: unknown;
    withEditOverlay?: boolean;
  }): Promise<Trace[]> {
    return this.dependencies.traces.read.getTracesWithSpans(
      input.projectId,
      input.traceIds,
      input.protections,
      undefined,
      {
        ...(input.withEditOverlay !== undefined ? { withEditOverlay: input.withEditOverlay } : {}),
      },
    );
  }

  /**
   * One trace's spans in the order a waterfall reads: earliest start first,
   * and where two spans start together the longer one first, so a parent is
   * never drawn under the child it contains.
   *
   * Answers no spans — rather than failing — when the project holds no such
   * trace, or when the trace carries none.
   */
  async readOrderedSpansForTrace(input: {
    projectId: string;
    traceId: string;
    protections: unknown;
  }): Promise<Span[]> {
    const traces = await this.readTracesWithSpans({
      projectId: input.projectId,
      traceIds: [input.traceId],
      protections: input.protections,
    });
    const trace = traces.find((candidate) => candidate.trace_id === input.traceId);
    if (!trace?.spans) return [];

    return trace.spans.sort((a, b) => {
      const aStart = a.timestamps?.started_at ?? 0;
      const bStart = b.timestamps?.started_at ?? 0;

      const startDiff = aStart - bStart;
      if (startDiff === 0) {
        const aEnd = a.timestamps?.finished_at ?? 0;
        const bEnd = b.timestamps?.finished_at ?? 0;
        return bEnd - aEnd;
      }

      return startDiff;
    });
  }

  /** Every trace in one conversation, resolved in full (#4991). */
  readThreadTraces(input: {
    projectId: string;
    threadId: string;
    protections: unknown;
  }): Promise<Trace[]> {
    return this.dependencies.traces.read.getTracesByThreadId(
      input.projectId,
      input.threadId,
      input.protections,
      { full: true },
    );
  }

  /** Every trace in each of several conversations, resolved in full (#4991). */
  readThreadsTraces(input: {
    projectId: string;
    threadIds: string[];
    protections: unknown;
    withEditOverlay?: boolean;
  }): Promise<Trace[]> {
    return this.dependencies.traces.read.getTracesWithSpansByThreadIds(
      input.projectId,
      input.threadIds,
      input.protections,
      {
        full: true,
        ...(input.withEditOverlay !== undefined ? { withEditOverlay: input.withEditOverlay } : {}),
      },
    );
  }

  /**
   * A page of traces drawn for a wizard's sample step, resolved in full.
   *
   * Two reads, in this order and no other: the list read for ids only (it
   * reads no content, so it stays on the preview), then the named traces in
   * full because the sample builder and the dataset builder both persist what
   * comes back and a truncated row corrupts what they write. Both wizards did
   * this for themselves, one `pageSize` apart.
   */
  async readSampleTraces(input: {
    query: TraceLegacyListInput;
    protections: unknown;
    pageSize: number;
  }): Promise<Trace[]> {
    const { groups } = await this.listTraces({
      query: { ...input.query, groupBy: "none", pageSize: input.pageSize },
      protections: input.protections,
    });

    const traceIds = groups.flatMap((group) => group.map((trace) => trace.trace_id));
    if (traceIds.length === 0) return [];

    return this.readTracesWithSpans({
      projectId: input.query.projectId,
      traceIds,
      protections: input.protections,
      occurredAt: { from: input.query.startDate, to: input.query.endDate },
    });
  }

  /** The evaluator verdicts on a page of traces, keyed by trace id. */
  readEvaluations(input: {
    projectId: string;
    traceIds: string[];
    protections: unknown;
  }): Promise<Record<string, Evaluation[]>> {
    return this.dependencies.traces.read.getEvaluationsMultiple(
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
    return this.dependencies.traces.read.getEvaluationInputs(input.projectId, input.evaluationId);
  }

  /** Topic and subtopic counts for the filtered window. */
  readTopicCounts(input: TraceLegacyFilterInput): Promise<TopicCountsResult> {
    return this.dependencies.traces.read.getTopicCounts(input);
  }

  /** The distinct customer ids and labels in the filtered window. */
  readCustomersAndLabels(input: TraceLegacyFilterInput): Promise<CustomersAndLabelsResult> {
    return this.dependencies.traces.read.getCustomersAndLabels(input);
  }

  /** Span names, metadata keys and evaluator names the project has produced. */
  readFieldNames(input: {
    projectId: string;
    startDate: number;
    endDate: number;
  }): Promise<DistinctFieldNamesResult> {
    return this.dependencies.traces.read.getDistinctFieldNames(
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
    return this.dependencies.traces.read.getSpanForPromptStudio(
      input.projectId,
      input.spanId,
      input.protections,
    );
  }

  // -------------------------------------------------------------------------
  // The project's topics, as the topic-count read labels its buckets
  // -------------------------------------------------------------------------

  /** The project's topic tree. */
  readTopics(
    input: Readonly<{ projectId: string }>,
  ): Promise<ReadonlyArray<Readonly<{ id: string; name: string; parentId: string | null }>>> {
    return this.dependencies.topics.getAll(input);
  }

  // -------------------------------------------------------------------------
  // The process's broadcast fabric
  // -------------------------------------------------------------------------

  /** The tenant's live-update emitter, for the duration of one subscription. */
  getTenantEmitter(tenantId: string): NodeJS.EventEmitter {
    return this.dependencies.broadcast.getTenantEmitter(tenantId);
  }

  /** Releases it when that subscription ends, however it ends. */
  cleanupTenantEmitter(tenantId: string): void {
    this.dependencies.broadcast.cleanupTenantEmitter(tenantId);
  }

  // -------------------------------------------------------------------------
  // The explorer's list, facet and session reads
  // -------------------------------------------------------------------------

  /** One page of the trace grid. */
  readTraceList(params: Parameters<TracesV2ListReader["getList"]>[0]): Promise<TraceListPage> {
    return this.dependencies.traces.list.getList(params);
  }

  /** One page of the Sessions lens. */
  readSessionGroups(
    params: Parameters<TracesV2SessionGroupsReader["getSessionGroups"]>[0],
  ): Promise<SessionGroupsResult> {
    return this.dependencies.traces.sessionGroups.getSessionGroups(params);
  }

  /** The filter sidebar's counts. */
  readFacets(
    params: Parameters<TracesV2ListReader["getFacets"]>[0],
  ): Promise<TraceListFacetCounts> {
    return this.dependencies.traces.list.getFacets(params);
  }

  /** How many traces have arrived since the grid last painted. */
  readNewCount(params: Parameters<TracesV2ListReader["getNewCount"]>[0]): Promise<number> {
    return this.dependencies.traces.list.getNewCount(params);
  }

  /** The typeahead's values for one field. */
  readSuggestions(params: Parameters<TracesV2ListReader["getSuggestions"]>[0]): Promise<string[]> {
    return this.dependencies.traces.list.getSuggestions(params);
  }

  /** The facet payload the sidebar opens with. */
  readDiscover(params: Parameters<TracesV2ListReader["getDiscover"]>[0]): Promise<DiscoverResult> {
    return this.dependencies.traces.list.getDiscover(params);
  }

  /** One facet's values, paged. */
  readFacetValues(
    params: Parameters<TracesV2ListReader["getFacetValues"]>[0],
  ): Promise<FacetValuesResult> {
    return this.dependencies.traces.list.getFacetValues(params);
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
    return this.dependencies.traces.summary.getByTraceId(input.projectId, input.traceId, {
      ...occurredAtHint(input.occurredAtMs),
      ...(input.visibilityCutoffMs !== undefined
        ? { visibilityCutoffMs: input.visibilityCutoffMs }
        : {}),
      ...(input.full !== undefined ? { full: input.full } : {}),
    });
  }

  /**
   * Whether the plan's visibility window teases this trace's content.
   *
   * Only free plans have a window, so a plan without one answers without
   * reading anything; when there is one, the trace's own summary decides it —
   * the same read the drawer header makes, which is what keeps the two from
   * disagreeing.
   *
   * A summary that cannot be read answers "teased". A correction quotes
   * captured content, so a trace whose age we cannot establish must not open
   * it: the failure is logged and the answer is the closed one.
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
    return this.dependencies.traces.spans.getSpanSummaryByTraceId({
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
    return this.dependencies.traces.spans.getSpansByTraceId({
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
    return this.dependencies.traces.spans.getSpansPaginated({
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
    return this.dependencies.traces.spans.getSpansSince({
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
    return this.dependencies.traces.spans.getSpanById({
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
    return this.dependencies.traces.spans.getSpanEvents({
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
    return this.dependencies.traces.spans.getLangwatchSignalsByTraceId({
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
    return this.dependencies.traces.spans.getSpanResourcesByTraceId({
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
    return this.dependencies.traces.spans.getTraceEventsByTraceId({
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
    return this.dependencies.traces.spans.getTraceEventRollupsByTraceIds({
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
    return this.dependencies.traces.tree.getSpanTreePage(input);
  }

  /** The tree nodes of a live trace whose row version is newer than a mark. */
  readSpanTreeDelta(input: SpanTreeDeltaInput): Promise<SpanTreeNode[]> {
    return this.dependencies.traces.tree.getSpanTreeDelta(input);
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
    return this.dependencies.traces.logRecords.getLogsByTraceId(
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
   * Renames a trace, attributed to the caller who asked for it.
   *
   * The attribution is here rather than in the door because "who renamed this"
   * is a property of the act, not of the transport it arrived over. The name
   * itself is validated before it gets here: an invalid one is a rejection of
   * the request, which is the door's to report.
   */
  changeTraceName(
    input: { projectId: string; traceId: string; newName: string; occurredAt?: number },
    by: TraceCaller,
  ): Promise<unknown> {
    return this.dependencies.traces.changeTraceName({
      tenantId: input.projectId,
      traceId: input.traceId,
      newName: input.newName,
      changedByUserId: by.id,
      occurredAt: input.occurredAt ?? Date.now(),
    });
  }

  /** The correction stored on a trace, before any reader-specific redaction. */
  readTraceEditOverlay(input: {
    projectId: string;
    traceId: string;
  }): Promise<TraceEditOverlayDto | null> {
    return this.dependencies.traces.editOverlay.getByTraceId({
      projectId: input.projectId,
      traceId: input.traceId,
    });
  }

  /**
   * Saves the correction, attributed to the caller who asked for it.
   *
   * The door used to stamp the reviewer twice — once on the first correction a
   * trace ever gets, once on every replacement — which is two chances to stamp
   * it differently or not at all.
   */
  saveTraceEditOverlay(
    input: { projectId: string; traceId: string; patch: unknown },
    by: TraceCaller,
  ): Promise<TraceEditOverlayDto> {
    return this.dependencies.traces.editOverlay.upsert({
      projectId: input.projectId,
      traceId: input.traceId,
      patch: input.patch,
      userId: by.id,
    });
  }

  /** Removes the correction outright. */
  deleteTraceEditOverlay(input: { projectId: string; traceId: string }): Promise<void> {
    return this.dependencies.traces.editOverlay.delete({
      projectId: input.projectId,
      traceId: input.traceId,
    });
  }

  // -------------------------------------------------------------------------
  // What other verticals answer about a trace
  // -------------------------------------------------------------------------

  /** The evaluation runs recorded against one trace. */
  readEvaluationRuns(
    input: Parameters<EvaluationService["findRunsByTraceId"]>[0],
  ): ReturnType<EvaluationService["findRunsByTraceId"]> {
    return this.dependencies.evaluations.findRunsByTraceId(input);
  }

  /** The pre-folded coding-agent session rollup for one trace, or null. */
  readCodingAgentSession(
    input: Parameters<CodingAgentService["tryGetSessionForTrace"]>[0],
  ): ReturnType<CodingAgentService["tryGetSessionForTrace"]> {
    return this.dependencies.codingAgents.tryGetSessionForTrace(input);
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
    return this.dependencies.share.resolveForViewer(input);
  }

  /** The cached share payload for this token AND these redactions, if any. */
  readCachedSharePayload(input: {
    token: string;
    protections: Protections;
  }): Promise<unknown> {
    return this.dependencies.share.tryGetCachedPayload(input);
  }

  /** Caches the share payload against this token and these redactions. */
  writeCachedSharePayload(input: {
    token: string;
    protections: Protections;
    payload: SharedTraceDto;
  }): Promise<void> {
    return this.dependencies.share.cachePayload(input);
  }

  /** The project card the share page prints above the trace. */
  readProject(projectId: string): Promise<{
    name: string | null;
    slug: string | null;
    language: string | null;
    framework: string | null;
  } | null> {
    return this.dependencies.projects.tryGetById(projectId);
  }
}
