import type { Trace } from "./trace-format.schemas.ts";
import type { Protections } from "./trace-viewer-protections.contract.ts";
import type { TraceEditOverlayDto, TraceEditOverlayPatch } from "./trace-edit-overlay.contract.ts";
import type { RecordCapturedSpanInput } from "./trace-captured-span.commands.ts";
import type { Span } from "./trace-format.schemas.ts";
import type {
  SpanSummaryRow,
  SpanResourceInfo,
  TraceEventRollup,
  TraceLogRecordDto,
  ModelUsageStatsRow,
  ModelSpanSampleRow,
} from "./trace-span-read-model.ts";
import type { SpanDetail, SpanLangwatchSignals } from "./trace-view.contract.ts";
import type { ElasticSearchEvent } from "./trace-format.schemas.ts";
import type { DerivedTraceEvent } from "./trace-derived-event.ts";
import type { SpanTreeNode, SpanTreePage } from "./trace.ts";
import type { SpanTreeDeltaInput, SpanTreeInput, TraceIngestWaitInput } from "./trace.queries.ts";
import type { TraceLegacyListInput, TracesForProjectResult } from "./trace-read.contract.ts";
import { moduleApi } from "@langwatch/runtime-composition";
import type {
  EvaluationTraceReadInput,
  EvaluationTraceSpan,
  EvaluationTraceEvent,
} from "./trace-evaluation.contract.ts";
import type {
  TraceByIdInput,
  TraceDerivedEventsInput,
  TraceSummaryLookupInput,
} from "./trace.queries.ts";
import type { TraceRecord } from "./trace-record.ts";
import type { TraceSummaryData } from "./trace-projection.ts";
import type {
  TraceFullReadInput,
  TraceFullRecord,
  TraceFullThreadReadInput,
} from "./trace-full-read.contract.ts";
import type {
  TraceQueryClassification,
  TraceQueryClassificationInput,
  TraceQueryFieldCatalogueInput,
} from "./trace-query.contract.ts";

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

/** Public Trace operations shared by process peers after boot composition. */
export interface TraceApi {
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
      downloadMode?: boolean;
      includeSpans?: boolean;
      resolveBlobs?: boolean;
      scrollId?: string | null;
    };
  }): Promise<TracesForProjectResult>;
  readTrace(input: {
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
  readThreadsTraces(input: {
    projectId: string;
    threadIds: string[];
    protections: unknown;
    withEditOverlay?: boolean;
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
  resolveViewerProtections(input: { projectId: string; userId: string | null }): Promise<Protections>;
  findExistingTraceIds(input: {
    projectId: string;
    traceIds: readonly string[];
  }): Promise<string[]>;
  loadTraces(input: {
    userId: string;
    projectId: string;
    traceIds: readonly string[];
  }): Promise<ReadonlyArray<Trace>>;
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
    ReadonlyArray<{
      spanId: string;
      timeUnixMs: number;
      body: string;
      attributes: Record<string, string>;
      resourceAttributes: Record<string, string>;
      scopeName: string;
      scopeVersion: string | null;
    }>
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
  readSpan(input: {
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
  }): Promise<Array<{ spanId: string; signals: SpanLangwatchSignals["signals"] }>>;
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
  readEvaluationInputs(input: {
    projectId: string;
    evaluationId: string;
  }): Promise<Record<string, unknown> | null>;
  readTopicCounts(input: TraceLegacyListInput): Promise<unknown>;
  readCustomersAndLabels(input: TraceLegacyListInput): Promise<unknown>;
  readFieldNames(input: {
    projectId: string;
    startDate: number;
    endDate: number;
  }): Promise<unknown>;
  readPromptStudioSpan(input: {
    projectId: string;
    spanId: string;
    protections: unknown;
  }): Promise<unknown>;
  readTopics(input: { projectId: string }): Promise<
    ReadonlyArray<
      Readonly<{
        id: string;
        name: string;
        parentId: string | null;
      }>
    >
  >;
  getTenantEmitter(tenantId: string): NodeJS.EventEmitter;
  cleanupTenantEmitter(tenantId: string): void;
  readTraceList(params: unknown): Promise<unknown>;
  readSessionGroups(params: unknown): Promise<unknown>;
  readFacets(params: unknown): Promise<unknown>;
  readNewCount(params: unknown): Promise<number>;
  readSuggestions(params: unknown): Promise<string[]>;
  readDiscover(params: unknown): Promise<unknown>;
  readFacetValues(params: unknown): Promise<unknown>;
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
  readTraceEditOverlay(input: {
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
  readProject(projectId: string): Promise<unknown>;
}

export const TraceApi = moduleApi<TraceApi>("trace");
