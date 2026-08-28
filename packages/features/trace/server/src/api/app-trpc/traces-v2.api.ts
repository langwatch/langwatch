/**
 * The trace explorer's reads over the process's tRPC transport — the `tracesV2.*`
 * surface, twenty-nine procedures behind one permission model.
 *
 *   list / sessions / listEvents:   the grid, the Sessions lens, and the events
 *                                   column the grid fills in per page.
 *   facets / newCount / suggest /
 *   discover / facetValues /
 *   onDiscoverUpdate:               the filter sidebar's vocabulary, its live
 *                                   counts, and the stream that tells a browser
 *                                   its facets were recomputed.
 *   conversationContext:            the turns either side of the open trace.
 *   aiQuery / aiAction:             the composer, which turns a sentence into a
 *                                   query or into a saved lens.
 *   header / changeName /
 *   changeMetadata:                 the drawer's summary, and the two things a
 *                                   reader may change about a trace.
 *   spansPaginated / spansDelta /
 *   spanTreePaginated /
 *   spanTreeDelta / spanTree /
 *   spanLangwatchSignals /
 *   spansFull / spanDetail /
 *   resourceInfo:                   the waterfall, live or paged, and one span
 *                                   opened in full.
 *   traceEvents / evals /
 *   traceLogs /
 *   codingAgentTranscript /
 *   codingAgentSession:             the timeline, the verdicts, the raw log
 *                                   records, and what a coding agent did.
 *
 * Every read takes `traces:view`; `changeName` and `changeMetadata` take
 * `traces:update`.
 *
 * Transport only: policy, input parsing, delegation, and the read-time
 * redaction every payload goes through on its way out. The mapping and
 * redaction themselves live in `trace-read-mappers.api.ts`, shared with the
 * anonymous `sharedTrace.get` surface so the two can never drift apart.
 *
 * The anonymous read is NOT here. ADR-057 keeps it on its own router.
 */
import { on } from "node:events";
import type { CodingAgentService, CodingAgentTranscript } from "@langwatch/coding-agent-contract";
import type { EvaluationService } from "@langwatch/evaluation-contract";
import { ValidationError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  changeTraceNameInputSchema,
  spanTreeDeltaTransportInputSchema,
  spanTreeTransportInputSchema,
  TRACE_NAME_MAX_LENGTH,
  TRACE_NAME_MIN_LENGTH,
  type DerivedTraceEvent,
  type ElasticSearchEvent,
  type DiscoverResult,
  type SessionGroupsResult,
  type Span,
  type SpanDetail,
  type SpanLangwatchSignals,
  type SpanResourceInfo,
  type SpanSummaryRow,
  type SpanTreeNode,
  type TraceCanonicalisationService,
  type TraceEventRollup,
  type TraceHeader,
  type TraceListFacetCounts,
  type TraceListPage,
  type TraceResourceInfoDto,
  type TraceService,
  type TraceSummaryData,
  type AiActionResult,
  type AiQueryResult,
  type FacetValuesResult,
} from "@langwatch/trace-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import type { Protections } from "../../services/trace-viewer-protections.service";
import {
  buildContentPrivacy,
  buildSpanContentRedactions,
  contentSearchTermsForViewer,
  deriveTraceDropPrivacy,
  gateTraceLogVisibility,
  mapSpanToDetail,
  mapSpansToDetailDtos,
  mapTraceSummaryToHeader,
  readDroppedFromParams,
  readPiiIncompleteFromParams,
  redactV2Content,
  toConversationContextTurn,
  mapLegacySpanSummaryToTreeNode,
  type TraceDerivedAttrPrefixes,
  type TraceLogRecordDto,
  type TraceReadMapperPorts,
} from "./trace-read-mappers.api";
import {
  gateHeaderCost,
  gateResources,
  gateSessionCost,
  gateSessionTitle,
  gateTreeCost,
  withoutHiddenResourceAttrs,
} from "./trace-view-gates.api";
import type { TracesTrpcEmitters } from "./traces.api";

const logger = createLogger("langwatch:api:traces-v2");

// ---------------------------------------------------------------------------
// The application this transport reads through
// ---------------------------------------------------------------------------

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

/** Every per-span read the drawer and the waterfall issue. */
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

type TracesV2Application = Readonly<{
  traces: Readonly<{
    list: TracesV2ListReader;
    sessionGroups: TracesV2SessionGroupsReader;
    spans: TracesV2SpanReader;
    summary: Readonly<{
      getByTraceId(
        tenantId: string,
        traceId: string,
        options?: {
          occurredAtMs?: number;
          visibilityCutoffMs?: number | null;
          full?: boolean;
        },
      ): Promise<TraceSummaryData>;
    }>;
    tree: TraceService;
    logRecords: Readonly<{
      getLogsByTraceId(
        tenantId: string,
        traceId: string,
        occurredAtMs?: number,
        limit?: number,
      ): Promise<TraceLogRecordReadRow[]>;
    }>;
    canonicalisation: TraceCanonicalisationService;
    changeTraceName(input: {
      tenantId: string;
      traceId: string;
      newName: string;
      changedByUserId: string;
      occurredAt: number;
    }): Promise<unknown>;
  }>;
  evaluations: EvaluationService;
  codingAgents: CodingAgentService;
  broadcast: TracesTrpcEmitters;
}>;

/** The process supplies authentication; authorization arrives as `policy`. */
export type TracesV2TrpcContext = Readonly<{
  app: TracesV2Application;
  session: Readonly<{ user: Readonly<{ id: string }> }>;
}>;

type TracesV2TrpcProcedures<
  TContext extends TracesV2TrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one declared permission.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

/**
 * The process capabilities this transport needs that Trace does not own.
 *
 * Each one belongs to another vertical — the viewer's protections and the plan
 * window are Identity's and Entitlement's, the composer is the model
 * providers', the span display and redaction passes are the legacy trace
 * read's, the content-key catalog is Data Privacy's, and the trace metadata
 * write and unmapped-cost suggestion are the application's. Injecting them is
 * what lets the transport move without dragging six features' modules with it.
 */
export type TracesV2TrpcPorts<TMetadata = unknown, TMetadataRaw = unknown> = Readonly<{
  /**
   * The caller's read-time redactions for one project: cost visibility, the
   * data-privacy policy's content categories, the restricted-attribute rules
   * and the plan's visibility cutoff. Resolved per request because they depend
   * on the session.
   */
  getViewerProtections(ctx: unknown, input: Readonly<{ projectId: string }>): Promise<Protections>;
  /** The plan's visibility window for one project, or null when unbounded. */
  getVisibilityCutoffMs(projectId: string): Promise<number | null>;
  /** The mapping and redaction ports the shared read mappers take. */
  mappers: TraceReadMapperPorts;
  /** The two ingest-derived content attribute prefixes. */
  derivedAttrPrefixes: TraceDerivedAttrPrefixes;
  /** The AI composer, which needs the request's model providers. */
  runAiQuery(
    input: Readonly<{
      projectId: string;
      prompt: string;
      timeRange: { from: number; to: number };
    }>,
    ctx: unknown,
  ): Promise<AiQueryResult>;
  runAiAction(
    input: Readonly<{
      projectId: string;
      prompt: string;
      timeRange: { from: number; to: number };
    }>,
    ctx: unknown,
  ): Promise<AiActionResult>;
  /**
   * The reserved-metadata write behind `changeMetadata`, and its parser.
   *
   * Both the parsed shape and the shape a caller SENDS are carried, because a
   * schema with defaults differs between them and tRPC types the client off
   * the sent shape. Naming only the parsed one would leave every caller of
   * this write unchecked.
   */
  traceMetadataUpdateSchema: z.ZodType<TMetadata, TMetadataRaw>;
  updateTraceMetadata(input: {
    projectId: string;
    traceId: string;
    metadata: TMetadata;
  }): Promise<void>;
  /**
   * Token usage with no price on it: the cost-mapping rule a reader could add.
   * Null when the span presents no unmapped-cost symptom.
   */
  deriveUnmappedCostSuggestion(input: {
    projectId: string;
    model: string | null;
    cost: number | null | undefined;
    promptTokens: number | null | undefined;
    completionTokens: number | null | undefined;
  }): Promise<SpanDetail["costSuggestion"]>;
  /**
   * The coding-agent log join. Claude Code's real `llm_request` spans carry
   * tokens and a `request_id` but no message content — that lives in the
   * trace's OTLP log records, and this is what puts it back on the span
   * BEFORE protections run.
   */
  codingAgentEnrichment: TracesV2CodingAgentEnrichmentPort;
  /**
   * The prompt-reference walk: an llm span whose `langwatch.prompt.*` lives on
   * a sibling `Prompt.compile` span. Returns the merged params, or null when
   * the walk found nothing.
   */
  resolveAncestorPromptParams(input: {
    tenantId: string;
    traceId: string;
    targetSpanId: string;
    occurredAtMs?: number;
    currentParams: Record<string, unknown> | null;
  }): Promise<Record<string, unknown> | null>;
  /** Whether an llm span already carries its own `langwatch.prompt.*`. */
  hasOwnPromptAttrs(params: Record<string, unknown> | null): boolean;
  /**
   * The application's `trace_not_found` handled error.
   *
   * Injected rather than constructed here because the code, its customer-safe
   * copy and its remediation live in the application's handled-error registry
   * (`features/errors/logic/codes.ts` and `presentation.ts`). Building an
   * equivalent class in this package would be a second definition of one wire
   * code, which is exactly how two surfaces start disagreeing about what a
   * customer reads.
   */
  traceNotFound(id: string): Error;
}>;

/**
 * The subset of the ports the three shared read helpers below need.
 *
 * Named separately so those helpers stay free of the metadata schema's type
 * parameters: they never touch `changeMetadata`, and threading two generics
 * through them only to discard them would make the REST caller of
 * `readCodingAgentTranscriptWithProtections` name types it does not have.
 */
export type TracesV2ReadPorts = Pick<
  TracesV2TrpcPorts,
  "getVisibilityCutoffMs" | "mappers" | "derivedAttrPrefixes" | "codingAgentEnrichment"
>;

/** The coding-agent log join, in the two shapes the reads need it. */
export type TracesV2CodingAgentEnrichmentPort = Readonly<{
  /** Whether a span is shaped like a coding-agent span at all. */
  isCodingAgentShapedSpan(span: Span): boolean;
  /** Bulk: every span of one trace, joined against the trace's log records. */
  enrichSpansFromLogs(input: {
    tenantId: string;
    traceId: string;
    spans: Span[];
    occurredAtMs?: number;
    logRecords: TracesV2Application["traces"]["logRecords"];
    traceCanonicalisation: TraceCanonicalisationService;
    codingAgents: CodingAgentService;
  }): Promise<Span[]>;
  /** Single: one span, with the trace's model-call order when it needs it. */
  enrichSingleSpanWithLogContent(input: {
    span: Span;
    modelCallRefs: unknown;
    logRows: TraceLogRecordReadRow[];
    traceCanonicalisation: TraceCanonicalisationService;
    codingAgents: CodingAgentService;
  }): Span;
  /** The light summary refs a single-span model-call join pairs against. */
  mapSummaryRowsToRefs(rows: SpanSummaryRow[]): unknown;
}>;

// ---------------------------------------------------------------------------
// Shared input fragments
// ---------------------------------------------------------------------------

/**
 * Reusable Zod fields for span-read endpoints that accept the partition-
 * pruning hint. The drawer carries the trace's approximate timestamp in
 * the URL, so callers thread it through every span query that targets
 * `stored_spans`. Spread into a procedure's input shape with `...`.
 */
const spanReadHintShape = {
  /**
   * Approximate trace timestamp (ms since epoch) used as a partition-
   * pruning hint on `stored_spans`. Supplying it narrows the scan from
   * every weekly partition (incl. cold S3) down to a ±2-day window.
   * Optional — missing/invalid values fall back to the unconstrained
   * scan path on the server.
   */
  occurredAtMs: z.number().int().optional(),
} as const;

function occurredAtFromInput(input: {
  occurredAtMs?: number;
}): { occurredAtMs: number } | Record<string, never> {
  return input.occurredAtMs !== undefined ? { occurredAtMs: input.occurredAtMs } : {};
}

/**
 * Shared filter-translation step for the list/facets/newCount procedures.
 * Each one accepts the same `query` text + `projectId` + `timeRange` and
 * needs the same null-coalesce → call → ?? undefined sequence.
 */
function buildFilterWhere(
  input: {
    projectId: string;
    timeRange: { from: number; to: number; live?: boolean };
    query?: string | null;
  },
  queryTranslation: TracesV2TrpcPorts["queryTranslation"],
) {
  return (
    queryTranslation.translateFilterToClickHouse(
      input.query ?? "",
      input.projectId,
      input.timeRange,
    ) ?? undefined
  );
}

const timeRangeSchema = z.object({
  from: z.number(),
  to: z.number(),
  live: z.boolean().optional(),
});

/**
 * Ceiling on one `listEvents` call, matching the list's largest page size.
 * The read is a primary-key `IN` over `(TenantId, TraceId, SpanId)`, so it
 * scales with the page rather than the project — but only if the page does.
 */
const MAX_LIST_EVENT_TRACE_IDS = 1000;

const sortSchema = z.object({
  columnId: z.string(),
  direction: z.enum(["asc", "desc"]),
});

// ---------------------------------------------------------------------------
// Reads shared between procedures
// ---------------------------------------------------------------------------

/**
 * Single-span twin of the bulk claude join for `spanDetail`: one trace-log
 * read, plus the light summary refs ONLY for model-call spans (their
 * positional input pairing needs the trace's call order; tool and
 * interaction joins are exact and skip the second read). Best-effort — any
 * read failure returns the un-enriched span, mirroring the bulk join's
 * never-fail contract.
 */
async function enrichSpanDetailFromCodingAgentLogs({
  app,
  span,
  tenantId,
  traceId,
  occurredAtMs,
  codingAgentEnrichment,
}: {
  app: TracesV2Application;
  span: Span;
  tenantId: string;
  traceId: string;
  occurredAtMs?: number;
  codingAgentEnrichment: TracesV2CodingAgentEnrichmentPort;
}): Promise<Span> {
  try {
    const needsSiblingRefs =
      typeof (span.params as Record<string, unknown> | null)?.request_id === "string";
    const [logRows, summaryRows] = await Promise.all([
      app.traces.logRecords.getLogsByTraceId(tenantId, traceId, occurredAtMs),
      needsSiblingRefs
        ? app.traces.spans.getSpanSummaryByTraceId({
            tenantId,
            traceId,
            ...(occurredAtMs !== undefined ? { occurredAtMs } : {}),
          })
        : Promise.resolve([]),
    ]);
    return codingAgentEnrichment.enrichSingleSpanWithLogContent({
      span,
      modelCallRefs: codingAgentEnrichment.mapSummaryRowsToRefs(summaryRows),
      logRows,
      traceCanonicalisation: app.traces.canonicalisation,
      codingAgents: app.codingAgents,
    });
  } catch (error) {
    logger.warn(
      {
        tenantId,
        traceId,
        spanId: span.span_id,
        error: error instanceof Error ? error.message : String(error),
      },
      "spanDetail coding-agent enrichment skipped: failed to read trace logs",
    );
    return span;
  }
}

/**
 * Load one trace's spans, enriched and REDACTED.
 *
 * Extracted so `spansFull` and `codingAgentTranscript` cannot drift apart. The
 * transcript endpoint returning content that had skipped this pass would be a way
 * around the data-privacy policy the span reads enforce, so there is exactly one
 * way in.
 */
async function loadSpansFullWithProtections({
  app,
  ports,
  projectId,
  traceId,
  occurredAtMs,
  protections,
}: {
  app: TracesV2Application;
  ports: TracesV2ReadPorts;
  projectId: string;
  traceId: string;
  occurredAtMs?: number;
  protections: Protections;
}): Promise<SpanDetail[]> {
  const hint = occurredAtFromInput(occurredAtMs !== undefined ? { occurredAtMs } : {});
  const storedSpans = await app.traces.spans.getSpansByTraceId({
    tenantId: projectId,
    traceId,
    visibilityCutoffMs: await ports.getVisibilityCutoffMs(projectId),
    ...hint,
  });
  // Claude Code's real `llm_request` spans carry tokens + `request_id` but NO
  // message content, which lives in the trace's OTLP log records. Join it on
  // BEFORE protections run, so the joined content goes through the same
  // redaction pass as any other span content rather than bypassing it.
  const spans = await ports.codingAgentEnrichment.enrichSpansFromLogs({
    logRecords: app.traces.logRecords,
    tenantId: projectId,
    traceId,
    spans: storedSpans,
    ...(occurredAtMs !== undefined ? { occurredAtMs } : {}),
    traceCanonicalisation: app.traces.canonicalisation,
    codingAgents: app.codingAgents,
  });

  return mapSpansToDetailDtos(spans, protections, ports.mappers);
}

/** Load one trace's log records, gated by the viewer's visibility exactly as `traceLogs` does. */
async function loadTraceLogsWithProtections({
  app,
  ports,
  projectId,
  traceId,
  occurredAtMs,
  protections,
  codingAgents,
}: {
  app: TracesV2Application;
  ports: TracesV2ReadPorts;
  projectId: string;
  traceId: string;
  occurredAtMs?: number;
  protections: Protections;
  codingAgents: CodingAgentService;
}): Promise<TraceLogRecordDto[]> {
  const visibilityCutoffMs = await ports.getVisibilityCutoffMs(projectId);
  const rows = await app.traces.logRecords.getLogsByTraceId(projectId, traceId, occurredAtMs);
  return rows.map((row) =>
    gateTraceLogVisibility(
      {
        spanId: row.spanId,
        timeUnixMs: row.timeUnixMs,
        body: row.body,
        attributes: row.attributes,
        resourceAttributes: row.resourceAttributes,
        scopeName: row.scopeName,
        scopeVersion: row.scopeVersion,
      },
      protections,
      visibilityCutoffMs,
      codingAgents,
      ports.derivedAttrPrefixes,
    ),
  );
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/** Installs the complete `tracesV2.*` tRPC surface on a process-owned root. */
export class TracesV2TrpcApi {
  /**
   * Transcript read shared by the `codingAgentTranscript` procedure below and
   * the REST route (`GET /api/traces/:traceId/transcript`). The REST caller
   * authenticates with a project API key, so it resolves `Protections` for the
   * project rather than for a user session and hands them in; both doors then
   * run identical span and log loads, so transcript content goes through the
   * same redaction passes as every sibling read.
   */
  static async readCodingAgentTranscript({
    app,
    ports,
    projectId,
    traceId,
    occurredAtMs,
    protections,
    codingAgents,
  }: {
    app: TracesV2Application;
    ports: TracesV2ReadPorts;
    projectId: string;
    traceId: string;
    occurredAtMs?: number;
    protections: Protections;
    codingAgents: CodingAgentService;
  }): Promise<CodingAgentTranscript> {
    const args = { app, ports, projectId, traceId, occurredAtMs, protections };
    const [spans, logs] = await Promise.all([
      loadSpansFullWithProtections(args),
      loadTraceLogsWithProtections({ ...args, codingAgents }),
    ]);

    return codingAgents.buildTranscript({
      spans,
      logs: logs.map((row) => ({
        timestampMs: row.timeUnixMs,
        attributes: (row.attributes ?? {}) as Record<string, unknown>,
        serviceName: row.resourceAttributes?.["service.name"] ?? null,
      })),
    });
  }

  static create<
    TContext extends TracesV2TrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
    TMetadata,
    TMetadataRaw,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: TracesV2TrpcProcedures<TContext, TOptions, TRoot>,
    ports: TracesV2TrpcPorts<TMetadata, TMetadataRaw>,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      list: policy("traces:view")(
        procedure.input(
          z.object({
            projectId: z.string(),
            timeRange: timeRangeSchema,
            sort: sortSchema,
            page: z.number().int().min(1).default(1),
            pageSize: z.number().int().min(1).max(1000).default(50),
            cursor: z
              .object({
                sortValue: z.number().finite(),
                traceId: z.string().min(1),
              })
              .optional(),
            query: z.string().nullish(),
          }),
        ),
      ).query(async ({ input, ctx }) => {
        const protections = await ports.getViewerProtections(ctx, {
          projectId: input.projectId,
        });
        const page = await ctx.app.traces.list.getList({
          tenantId: input.projectId,
          timeRange: input.timeRange,
          sort: input.sort,
          page: input.page,
          pageSize: input.pageSize,
          cursor: input.cursor,
          filterWhere: buildFilterWhere(input, ports.queryTranslation),
          visibilityCutoffMs: await ports.getVisibilityCutoffMs(input.projectId),
        });
        return {
          ...page,
          items: page.items.map((it) =>
            redactV2Content(it, protections, ports.mappers.contentPrivacy),
          ),
        };
      }),

      /**
       * The Sessions lens read (specs/traces-v2/sessions-lens.feature): one row
       * per `gen_ai.conversation.id` with TRUE rollups computed in ClickHouse
       * over every trace of the session in range, unlike the client grouping it
       * replaces, which could only sum the fetched page. The free-text query
       * ALSO matches session transcript content in `log_records`, so searching
       * "#6418" finds the session whose transcript mentions it, for a viewer
       * allowed to read that content: see `contentSearchTermsForViewer`.
       */
      sessions: policy("traces:view")(
        procedure.input(
          z.object({
            projectId: z.string(),
            timeRange: timeRangeSchema,
            sort: sortSchema.optional(),
            pageSize: z.number().int().min(1).max(100).default(50),
            cursor: z.string().optional(),
            query: z.string().nullish(),
          }),
        ),
      ).query(async ({ input, ctx }) => {
        const protections = await ports.getViewerProtections(ctx, {
          projectId: input.projectId,
        });
        const result = await ctx.app.traces.sessionGroups.getSessionGroups({
          tenantId: input.projectId,
          timeRange: input.timeRange,
          sort: input.sort,
          pageSize: input.pageSize,
          cursor: input.cursor,
          filterWhere: buildFilterWhere(input, ports.queryTranslation),
          contentTerms: contentSearchTermsForViewer({
            terms: ports.queryTranslation.extractFreeTextTerms(input.query ?? ""),
            protections,
          }),
          visibilityCutoffMs: await ports.getVisibilityCutoffMs(input.projectId),
        });
        return {
          ...result,
          // Previews and the generated session title are captured content,
          // spend follows cost:view. The same viewer gates the trace header
          // applies (ADR-057).
          sessions: gateSessionCost({
            sessions: gateSessionTitle({
              sessions: result.sessions.map((session) =>
                redactV2Content(session, protections, ports.mappers.contentPrivacy),
              ),
              protections,
            }),
            protections,
          }),
        };
      }),

      /**
       * Event rollups for the trace list's Events column, keyed by trace id.
       *
       * Its own query rather than part of `list`: events live in `stored_spans`,
       * not on the summary fold, so bundling them would put a second table's read
       * in front of the paint that every user waits on — including the ones whose
       * columns and grouping never ask for events.
       */
      listEvents: policy("traces:view")(
        procedure.input(
          z.object({
            projectId: z.string(),
            traceIds: z.array(z.string().min(1)).max(MAX_LIST_EVENT_TRACE_IDS),
            timeRange: timeRangeSchema,
          }),
        ),
      ).query(async ({ input, ctx }): Promise<Record<string, TraceEventRollup>> =>
        ctx.app.traces.spans.getTraceEventRollupsByTraceIds({
          tenantId: input.projectId,
          traceIds: input.traceIds,
          timeRange: input.timeRange,
        }),
      ),

      facets: policy("traces:view")(
        procedure.input(
          z.object({
            projectId: z.string(),
            timeRange: timeRangeSchema,
            query: z.string().nullish(),
          }),
        ),
      ).query(async ({ input, ctx }) => {
        return ctx.app.traces.list.getFacets({
          tenantId: input.projectId,
          timeRange: input.timeRange,
          filterWhere: buildFilterWhere(input, ports.queryTranslation),
        });
      }),

      newCount: policy("traces:view")(
        procedure.input(
          z.object({
            projectId: z.string(),
            timeRange: timeRangeSchema,
            since: z.number(),
            query: z.string().nullish(),
          }),
        ),
      ).query(async ({ input, ctx }) => {
        const count = await ctx.app.traces.list.getNewCount({
          tenantId: input.projectId,
          timeRange: input.timeRange,
          since: input.since,
          filterWhere: buildFilterWhere(input, ports.queryTranslation),
        });
        return { count };
      }),

      suggest: policy("traces:view")(
        procedure.input(
          z.object({
            projectId: z.string(),
            field: z.string(),
            prefix: z.string(),
            limit: z.number().int().min(1).max(100).default(20),
          }),
        ),
      ).query(async ({ input, ctx }) => {
        const values = await ctx.app.traces.list.getSuggestions({
          tenantId: input.projectId,
          field: input.field,
          prefix: input.prefix,
          limit: input.limit,
        });
        return { values };
      }),

      /**
       * Conversation/thread context for the trace drawer. Bypasses the search
       * query language so conversationIds with arbitrary characters work
       * unconditionally — builds a typed WHERE fragment server-side.
       */
      conversationContext: policy("traces:view")(
        procedure.input(
          z.object({
            projectId: z.string(),
            conversationId: z.string().min(1),
          }),
        ),
      ).query(async ({ input, ctx }) => {
        const protections = await ports.getViewerProtections(ctx, {
          projectId: input.projectId,
        });
        // Window: conversation membership is timeless; cap at 1y to keep
        // partition pruning effective.
        const now = Date.now();
        const timeRange = { from: now - 365 * 24 * 60 * 60 * 1000, to: now };
        const filterWhere = {
          sql: "Attributes['gen_ai.conversation.id'] = {threadConversationId:String}",
          params: { threadConversationId: input.conversationId },
        };
        const page = await ctx.app.traces.list.getList({
          tenantId: input.projectId,
          timeRange,
          sort: { columnId: "time", direction: "asc" },
          page: 1,
          pageSize: 200,
          filterWhere,
          visibilityCutoffMs: await ports.getVisibilityCutoffMs(input.projectId),
        });
        const turns = page.items.map((t) =>
          toConversationContextTurn({
            trace: t,
            protections,
            contentPrivacy: ports.mappers.contentPrivacy,
          }),
        );
        // Position/previous/next are derived client-side from the active
        // traceId so the cache key doesn't churn on J/K navigation.
        return {
          conversationId: input.conversationId,
          turns,
          total: turns.length,
        };
      }),

      discover: policy("traces:view")(
        procedure.input(
          z.object({
            projectId: z.string(),
            timeRange: timeRangeSchema,
          }),
        ),
      ).query(async ({ input, ctx }) => {
        return ctx.app.traces.list.getDiscover({
          tenantId: input.projectId,
          timeRange: input.timeRange,
        });
      }),

      /**
       * SSE subscription that pushes `discover_updated` events to active
       * browsers when a tenant's facet payload finishes background refresh.
       * The client listens, invalidates its TanStack cache for
       * `tracesV2.discover`, and refetches — landing the fresh payload
       * without polling.
       *
       * Mirrors the shape of `traces.onTraceUpdate` so the existing
       * `useSSESubscription` hook handles it without changes.
       */
      onDiscoverUpdate: policy("traces:view")(
        procedure.input(z.object({ projectId: z.string() })),
      ).subscription(async function* (opts) {
        const { projectId } = opts.input;
        const emitter = opts.ctx.app.broadcast.getTenantEmitter(projectId);
        try {
          for await (const eventArgs of on(emitter, "discover_updated", {
            signal: opts.signal,
          })) {
            yield eventArgs[0];
          }
        } finally {
          opts.ctx.app.broadcast.cleanupTenantEmitter(projectId);
        }
      }),

      facetValues: policy("traces:view")(
        procedure.input(
          z.object({
            projectId: z.string(),
            timeRange: timeRangeSchema,
            facetKey: z.string(),
            prefix: z.string().optional(),
            limit: z.number().int().min(1).max(1000).default(50),
            offset: z.number().int().min(0).default(0),
          }),
        ),
      ).query(async ({ input, ctx }) => {
        return ctx.app.traces.list.getFacetValues({
          tenantId: input.projectId,
          timeRange: input.timeRange,
          facetKey: input.facetKey,
          prefix: input.prefix,
          limit: input.limit,
          offset: input.offset,
        });
      }),

      aiQuery: policy("traces:view")(
        procedure.input(
          z.object({
            projectId: z.string(),
            prompt: z.string().min(1).max(2000),
            timeRange: timeRangeSchema,
          }),
        ),
      ).mutation(async ({ input, ctx }) => {
        return ports.runAiQuery(
          {
            projectId: input.projectId,
            prompt: input.prompt,
            timeRange: { from: input.timeRange.from, to: input.timeRange.to },
          },
          ctx,
        );
      }),

      // Higher-level AI action — the model picks between filtering and creating
      // a saved lens. The composer in the search bar uses this so users can
      // say "save as Failing GPT-4" and get a new tab, or "show errors" and
      // just get a query applied.
      aiAction: policy("traces:view")(
        procedure.input(
          z.object({
            projectId: z.string(),
            prompt: z.string().min(1).max(2000),
            timeRange: timeRangeSchema,
          }),
        ),
      ).mutation(async ({ input, ctx }) => {
        return ports.runAiAction(
          {
            projectId: input.projectId,
            prompt: input.prompt,
            timeRange: { from: input.timeRange.from, to: input.timeRange.to },
          },
          ctx,
        );
      }),

      header: policy("traces:view")(
        procedure.input(
          z.object({
            projectId: z.string(),
            traceId: z.string(),
            /**
             * Optional approximate trace timestamp (ms since epoch) used as a
             * partition-pruning hint. The drawer typically opens from a row
             * click that already knows the trace's `timestamp`; passing it
             * here trims the heavy summary fetch from a full-table scan to a
             * few partitions.
             */
            occurredAtMs: z.number().int().optional(),
            /**
             * Whether to resolve any offloaded (ADR-022) input/output in full
             * before returning. Costs one extra spans read per call — only the
             * drawer's own detail read needs it; every other caller (hover
             * peek, name lookups, bulk hydrators, sibling prefetch) reads a
             * truncated preview or discards the content immediately, so every
             * caller in this codebase passes it explicitly, true or false.
             *
             * Defaults to `true` (the pre-existing, unconditional behavior)
             * purely for rollout safety: a browser tab still running the
             * previous frontend bundle sends no `full` field at all, and this
             * default keeps that in-flight request working exactly as before
             * instead of a Zod validation error, until the tab refreshes onto
             * the bundle that sends it. Every call site added by this change
             * passes the field explicitly — this default only ever backstops
             * a stale client, never a caller in the current code.
             */
            full: z.boolean().default(true),
          }),
        ),
      ).query(async ({ input, ctx }): Promise<TraceHeader> => {
        const protections = await ports.getViewerProtections(ctx, {
          projectId: input.projectId,
        });
        const summary = await ctx.app.traces.summary.getByTraceId(input.projectId, input.traceId, {
          ...(input.occurredAtMs !== undefined ? { occurredAtMs: input.occurredAtMs } : {}),
          visibilityCutoffMs: await ports.getVisibilityCutoffMs(input.projectId),
          full: input.full,
        });
        const rawHeader = mapTraceSummaryToHeader(summary);
        // Cost is gated by the viewer's own `cost:view` (via `protections`), the
        // same rule the detail-pane spans apply through `applySpanProtections` —
        // a `traces:view`-only viewer must not see spend in the header either.
        const header = gateHeaderCost({
          header: redactV2Content(rawHeader, protections, ports.mappers.contentPrivacy),
          protections,
        });
        header.privacy = await deriveTraceDropPrivacy(
          rawHeader,
          input.projectId,
          ports.mappers.contentPrivacy,
        );

        return header;
      }),

      /**
       * Lets a user rename a trace. Trim happens in the procedure so the event
       * always carries a canonical form, then the schema check rejects empty /
       * over-long names — when those rejections fire we surface them as a
       * `ValidationError` (HandledError), so the client receives the rich
       * `domainError` payload via tRPC's error formatter alongside the safe
       * user-facing message. The command pipeline still re-validates via Zod
       * as a defence-in-depth check (replays from a poisoned event store).
       */
      changeName: policy("traces:update")(
        procedure.input(
          z.object({
            projectId: z.string(),
            traceId: z.string(),
            newName: z.string(),
          }),
        ),
      ).mutation(async ({ input, ctx }) => {
        const trimmed = input.newName.trim();
        const parsed = changeTraceNameInputSchema.safeParse({ newName: trimmed });
        if (!parsed.success) {
          throw new ValidationError(
            `Trace name must be between ${TRACE_NAME_MIN_LENGTH} and ${TRACE_NAME_MAX_LENGTH} characters after trimming`,
            {
              meta: {
                field: "newName",
                minLength: TRACE_NAME_MIN_LENGTH,
                maxLength: TRACE_NAME_MAX_LENGTH,
                receivedLength: trimmed.length,
                fieldErrors: parsed.error.flatten().fieldErrors,
              },
            },
          );
        }

        await ctx.app.traces.changeTraceName({
          tenantId: input.projectId,
          traceId: input.traceId,
          newName: parsed.data.newName,
          changedByUserId: ctx.session.user.id,
          occurredAt: Date.now(),
        });

        return { traceId: input.traceId, newName: parsed.data.newName };
      }),

      changeMetadata: policy("traces:update")(
        procedure.input(
          z.object({
            projectId: z.string(),
            traceId: z.string(),
            metadata: ports.traceMetadataUpdateSchema,
          }),
        ),
      ).mutation(async ({ input }) => {
        await ports.updateTraceMetadata(input);
        return { traceId: input.traceId };
      }),

      spansPaginated: policy("traces:view")(
        procedure.input(
          z.object({
            projectId: z.string(),
            traceId: z.string(),
            limit: z.number().int().min(1).max(1000).default(250),
            offset: z.number().int().min(0).default(0),
            ...spanReadHintShape,
          }),
        ),
      ).query(async ({ input, ctx }) => {
        const protections = await ports.getViewerProtections(ctx, {
          projectId: input.projectId,
        });
        const page = await ctx.app.traces.spans.getSpansPaginated({
          tenantId: input.projectId,
          traceId: input.traceId,
          visibilityCutoffMs: await ports.getVisibilityCutoffMs(input.projectId),
          limit: input.limit,
          offset: input.offset,
          ...occurredAtFromInput(input),
        });
        // These are full legacy spans (input/output/params/metrics), so the
        // legacy span protections apply as-is: category visibility, cost,
        // restricted custom attributes, and hidden content scrubbed wherever
        // it rides along (e.g. raw gen_ai message attributes inside params).
        const redactions = buildSpanContentRedactions(
          page.spans,
          protections,
          ports.mappers.spanProtection,
        );
        return {
          ...page,
          spans: page.spans.map((span) =>
            ports.mappers.spanProtection.applySpanProtections(span, protections, redactions),
          ),
        };
      }),

      spansDelta: policy("traces:view")(
        procedure.input(
          z.object({
            projectId: z.string(),
            traceId: z.string(),
            sinceStartTimeMs: z.number(),
            ...spanReadHintShape,
          }),
        ),
      ).query(async ({ input, ctx }) => {
        const protections = await ports.getViewerProtections(ctx, {
          projectId: input.projectId,
        });
        const spans = await ctx.app.traces.spans.getSpansSince({
          tenantId: input.projectId,
          traceId: input.traceId,
          sinceStartTimeMs: input.sinceStartTimeMs,
          visibilityCutoffMs: await ports.getVisibilityCutoffMs(input.projectId),
          ...occurredAtFromInput(input),
        });
        const redactions = buildSpanContentRedactions(
          spans,
          protections,
          ports.mappers.spanProtection,
        );
        return spans.map((span) =>
          ports.mappers.spanProtection.applySpanProtections(span, protections, redactions),
        );
      }),

      /**
       * One page of the span tree in `(startTimeMs, spanId)` order. This is the
       * only fetch path the frontend uses for span trees — traces can carry
       * 20k–100k+ spans, so the client assembles the tree page by page (see
       * `spanTreePagedQuery.ts`) instead of ever pulling it in one response.
       * `nextCursor` is null on the final page.
       */
      spanTreePaginated: policy("traces:view")(procedure.input(spanTreeTransportInputSchema)).query(
        async ({ input, ctx }) => {
          const protections = await ports.getViewerProtections(ctx, {
            projectId: input.projectId,
          });
          return ctx.app.traces.tree.getSpanTreePage({
            ...input,
            canSeeCosts: protections.canSeeCosts === true,
          });
        },
      ),

      /**
       * Spans of a live trace whose row version is newer than `sinceUpdatedAtMs`.
       * Keyed on the row version rather than the span start so an in-place update
       * (end time, duration, status, cost) is picked up too — the root span
       * starts first and ends last, so a start-keyed delta left its duration, and
       * with it the waterfall's time scale, frozen at first projection.
       */
      spanTreeDelta: policy("traces:view")(
        procedure.input(spanTreeDeltaTransportInputSchema),
      ).query(async ({ input, ctx }) => {
        const protections = await ports.getViewerProtections(ctx, {
          projectId: input.projectId,
        });
        return ctx.app.traces.tree.getSpanTreeDelta({
          ...input,
          canSeeCosts: protections.canSeeCosts === true,
        });
      }),

      /**
       * Whole-tree read in one response. The frontend no longer fetches through
       * this — `useSpanTree` pages via `spanTreePaginated` under the same React
       * Query key, and this procedure remains as that cache entry's type/key
       * anchor (preview seeding, SSE invalidation, cancel). The underlying read
       * is bounded (`MAX_LIGHT_SPAN_READ_ROWS`) so a direct call can never
       * materialize a 100k-span trace in one shot.
       */
      spanTree: policy("traces:view")(
        procedure.input(
          z.object({
            projectId: z.string(),
            traceId: z.string(),
            ...spanReadHintShape,
          }),
        ),
      ).query(async ({ input, ctx }): Promise<SpanTreeNode[]> => {
        const protections = await ports.getViewerProtections(ctx, {
          projectId: input.projectId,
        });
        const rows = await ctx.app.traces.spans.getSpanSummaryByTraceId({
          tenantId: input.projectId,
          traceId: input.traceId,
          ...occurredAtFromInput(input),
        });
        return gateTreeCost({
          nodes: rows.map(mapLegacySpanSummaryToTreeNode),
          protections,
        });
      }),

      /**
       * Per-span LangWatch instrumentation signals (prompt, scenario, user,
       * thread, evaluation, rag, metadata, genai). Fired secondarily by the
       * waterfall and span-list views so the primary `spanTree` query stays
       * cheap; UIs render badges + filter once this resolves.
       */
      spanLangwatchSignals: policy("traces:view")(
        procedure.input(
          z.object({
            projectId: z.string(),
            traceId: z.string(),
            ...spanReadHintShape,
          }),
        ),
      ).query(async ({ input, ctx }): Promise<SpanLangwatchSignals[]> => {
        const rows = await ctx.app.traces.spans.getLangwatchSignalsByTraceId({
          tenantId: input.projectId,
          traceId: input.traceId,
          ...occurredAtFromInput(input),
        });
        return rows.map((r) => ({ spanId: r.spanId, signals: r.signals }));
      }),

      /**
       * Full span data for every span in a trace — used by the LLM Optimized
       * Trace markdown view to render per-span attributes and input/output.
       * Heavier than spanTree; fetch lazily.
       */
      spansFull: policy("traces:view")(
        procedure.input(
          z.object({
            projectId: z.string(),
            traceId: z.string(),
            ...spanReadHintShape,
          }),
        ),
      ).query(async ({ input, ctx }): Promise<SpanDetail[]> => {
        const protections = await ports.getViewerProtections(ctx, {
          projectId: input.projectId,
        });
        return loadSpansFullWithProtections({
          app: ctx.app,
          ports,
          projectId: input.projectId,
          traceId: input.traceId,
          ...occurredAtFromInput(input),
          protections,
        });
      }),

      /**
       * The coding-agent TRANSCRIPT for one trace — what the agent did, in order.
       *
       * The Terminal view used to assemble this in the browser out of three modules.
       * It lives here now because a transcript is not a rendering concern: the CLI
       * wants it, an MCP server wants it, and an export wants it, and none of them
       * are going to run React to get one. One derivation, one answer.
       *
       * Reads spans AND logs through the same loaders the sibling endpoints use, so
       * its content has been through the identical redaction pass — a transcript
       * endpoint that did its own reads would be a way around the data-privacy
       * policy, which is precisely why it does not.
       */
      codingAgentTranscript: policy("traces:view")(
        procedure.input(
          z.object({
            projectId: z.string(),
            traceId: z.string(),
            ...spanReadHintShape,
          }),
        ),
      ).query(async ({ input, ctx }): Promise<CodingAgentTranscript> => {
        const protections = await ports.getViewerProtections(ctx, {
          projectId: input.projectId,
        });
        return TracesV2TrpcApi.readCodingAgentTranscript({
          app: ctx.app,
          ports,
          projectId: input.projectId,
          traceId: input.traceId,
          ...occurredAtFromInput(input),
          protections,
          codingAgents: ctx.app.codingAgents,
        });
      }),

      spanDetail: policy("traces:view")(
        procedure.input(
          z.object({
            projectId: z.string(),
            traceId: z.string(),
            spanId: z.string(),
            ...spanReadHintShape,
          }),
        ),
      ).query(async ({ input, ctx }): Promise<SpanDetail> => {
        const protections = await ports.getViewerProtections(ctx, {
          projectId: input.projectId,
        });
        const hint = occurredAtFromInput(input);
        // One narrow span fetch + one narrow events fetch in parallel —
        // both keyed by SpanId (and partition-pruned by occurredAtMs when
        // available). Replaces an older path that pulled every span in the
        // trace into Node memory just to .find() one, plus a third query
        // whose result was never read.
        const [span, rawEvents] = await Promise.all([
          ctx.app.traces.spans.getSpanById({
            tenantId: input.projectId,
            traceId: input.traceId,
            spanId: input.spanId,
            visibilityCutoffMs: await ports.getVisibilityCutoffMs(input.projectId),
            ...hint,
          }),
          ctx.app.traces.spans.getSpanEvents({
            tenantId: input.projectId,
            traceId: input.traceId,
            spanId: input.spanId,
            ...hint,
          }),
        ]);

        if (!span) {
          throw ports.traceNotFound(input.spanId);
        }

        // Coding-agent spans store their content in the trace's OTLP LOGS, not
        // on the span row — join it on here, BEFORE protections, so the joined
        // content goes through the same redaction pass as any other span
        // content (identical order to loadSpansFullWithProtections). Gated so
        // only coding-agent-shaped spans pay the log read.
        const targetSpan = ports.codingAgentEnrichment.isCodingAgentShapedSpan(span)
          ? await enrichSpanDetailFromCodingAgentLogs({
              app: ctx.app,
              span,
              tenantId: input.projectId,
              traceId: input.traceId,
              ...(hint.occurredAtMs !== undefined ? { occurredAtMs: hint.occurredAtMs } : {}),
              codingAgentEnrichment: ports.codingAgentEnrichment,
            })
          : span;

        // Span-level protections first (category visibility, restricted custom
        // attributes, hidden content scrubbed out of params and events), then
        // the DTO pass below.
        const redactions = buildSpanContentRedactions(
          [targetSpan],
          protections,
          ports.mappers.spanProtection,
        );
        const protectedSpan = ports.mappers.spanProtection.applySpanProtections(
          targetSpan,
          protections,
          redactions,
        );

        const detail = mapSpanToDetail(
          protectedSpan,
          rawEvents.map((e) => ({
            name: e.event_type,
            timeUnixMs:
              typeof e.timestamps.started_at === "number"
                ? e.timestamps.started_at
                : parseInt(String(e.timestamps.started_at), 10),
            attributes: ports.mappers.spanProtection.redactObject(
              Object.fromEntries([
                ...e.event_details.map((d) => [d.key, d.value]),
                ...e.metrics.map((m) => [m.key, m.value]),
              ]),
              redactions,
            ),
          })),
          ports.mappers.spanDisplay,
        );

        // SDK pattern: `Prompt.compile` / `PromptApiService.get` siblings
        // carry `langwatch.prompt.*` while the actual `llm` span next door
        // does not. Walk ancestors/siblings here so the v2 drawer's prompt
        // accordion lights up on the llm span too (matches legacy
        // SpanDetails). One extra trace-scoped read, only when the llm
        // span has no own prompt attrs.
        if (
          detail.type === "llm" &&
          // Coding-agent traces carry no `langwatch.prompt.*` anywhere, so the
          // full-trace ancestor walk is a guaranteed miss — skipping it makes
          // the enriched spanDetail read CHEAPER than before for these spans.
          !ports.codingAgentEnrichment.isCodingAgentShapedSpan(span) &&
          !ports.hasOwnPromptAttrs(detail.params as Record<string, unknown> | null)
        ) {
          const enriched = await ports.resolveAncestorPromptParams({
            tenantId: input.projectId,
            traceId: input.traceId,
            targetSpanId: input.spanId,
            ...(hint.occurredAtMs !== undefined ? { occurredAtMs: hint.occurredAtMs } : {}),
            currentParams: detail.params as Record<string, unknown> | null,
          });
          if (enriched) {
            detail.params = enriched;
          }
        }

        // Token usage with no price on it, offer the user a cost mapping.
        // The cheap guards run first; the rule lookup only fires for spans
        // that actually present the unmapped-cost symptom.
        detail.costSuggestion = await ports.deriveUnmappedCostSuggestion({
          projectId: input.projectId,
          model: detail.model ?? null,
          cost: detail.metrics?.cost,
          promptTokens: detail.metrics?.promptTokens,
          completionTokens: detail.metrics?.completionTokens,
        });

        const redactedDetail = redactV2Content(detail, protections, ports.mappers.contentPrivacy);
        const detailParams = detail.params as Record<string, unknown> | null;
        redactedDetail.contentPrivacy = buildContentPrivacy(
          protections,
          readDroppedFromParams(detailParams, ports.mappers.contentPrivacy),
        );
        redactedDetail.piiAnalysisIncomplete = readPiiIncompleteFromParams(
          detailParams,
          ports.mappers.contentPrivacy,
        );
        redactedDetail.restrictedAttributes = protections.restrictedAttributes ?? null;
        return redactedDetail;
      }),

      /**
       * OTel resource attributes + instrumentation scope per span. Surfaced in
       * the drawer's metadata section and as the "scope" chip on traces and
       * spans. Standard span mapping drops both, so this reads them raw.
       */
      resourceInfo: policy("traces:view")(
        procedure.input(
          z.object({
            projectId: z.string(),
            traceId: z.string(),
            ...spanReadHintShape,
          }),
        ),
      ).query(async ({ input, ctx }): Promise<TraceResourceInfoDto> => {
        const protections = await ports.getViewerProtections(ctx, {
          projectId: input.projectId,
        });
        const rows = await ctx.app.traces.spans.getSpanResourcesByTraceId({
          tenantId: input.projectId,
          traceId: input.traceId,
          ...occurredAtFromInput(input),
        });

        const spans = rows.map((r) => ({
          spanId: r.spanId,
          parentSpanId: r.parentSpanId,
          resourceAttributes: withoutHiddenResourceAttrs(r.resourceAttributes),
          scope: { name: r.scopeName ?? "", version: r.scopeVersion },
        }));

        // Pick the root span (no parent) if present; fall back to earliest.
        const root = rows.find((r) => r.parentSpanId == null) ?? rows[0] ?? null;

        // `withoutHiddenResourceAttrs` drops the fixed non-billable set; layer the
        // viewer's data-privacy restrict rules on top via `gateResources` so the
        // authenticated read honours the same hidden-attribute policy as the share
        // surface.
        return gateResources({
          resources: {
            rootSpanId: root?.spanId ?? null,
            resourceAttributes: withoutHiddenResourceAttrs(root?.resourceAttributes ?? {}),
            scope: root ? { name: root.scopeName ?? "", version: root.scopeVersion } : null,
            spans,
          },
          protections,
        });
      }),

      /**
       * Trace-level events ({spanId, timestamp, name, attributes}) for the drawer.
       * Split off the header so the header stays a pure summary read; the drawer
       * fires this separately (like evals), and it reads only the `Events.*`
       * columns rather than re-fetching the spans the tree already loads.
       */
      traceEvents: policy("traces:view")(
        procedure.input(
          z.object({
            projectId: z.string(),
            traceId: z.string(),
            ...spanReadHintShape,
          }),
        ),
      ).query(async ({ input, ctx }): Promise<DerivedTraceEvent[]> => {
        const protections = await ports.getViewerProtections(ctx, {
          projectId: input.projectId,
        });
        const events = await ctx.app.traces.spans.getTraceEventsByTraceId({
          tenantId: input.projectId,
          traceId: input.traceId,
          ...occurredAtFromInput(input),
        });
        // Event/exception attributes are captured content — same gating as the
        // shared-trace payload, so the two surfaces cannot drift apart.
        return ports.mappers.spanProtection.applyDerivedTraceEventProtections(events, protections);
      }),

      evals: policy("traces:view")(
        procedure.input(
          z.object({
            projectId: z.string(),
            traceId: z.string(),
          }),
        ),
      ).query(async ({ input, ctx }) => {
        return ctx.app.evaluations.findRunsByTraceId({
          tenantId: input.projectId,
          traceId: input.traceId,
        });
      }),

      /**
       * The pre-folded coding-agent session rollup for one trace (ADR-056).
       *
       * Returns null for an ordinary LLM trace — the fold writes no row for those,
       * so null is the normal answer rather than an error, and the caller simply
       * doesn't offer the Session view.
       *
       * Unlike the sibling span / log reads this needs NO content redaction: the row
       * is counters, bounded sets and ids by construction. It carries no prompt, no
       * reply and no tool output, so there is nothing here for the data-privacy
       * policy to gate. (If that ever stops being true, this comment is the thing
       * that has to change first.)
       */
      codingAgentSession: policy("traces:view")(
        procedure.input(
          z.object({
            projectId: z.string(),
            traceId: z.string(),
          }),
        ),
      ).query(async ({ ctx, input }) => {
        // Two keyed seeks (ADR-056 §4): the (trace → session) map, then the
        // session row — which already spans every trace of the run, so no
        // conversation-membership fan-out is needed here anymore.
        return ctx.app.codingAgents.tryGetSessionForTrace({
          projectId: input.projectId,
          traceId: input.traceId,
        });
      }),

      /**
       * Every log record correlated to one trace (generic — not Claude-specific).
       * Logs key by traceId (to spans only via `request_id`), so this is a
       * trace-level read: the raw-log inspector renders untruncated bodies on
       * demand, and the dashboard frontend join composes span content client-side
       * from these logs. `occurredAtMs` is threaded as a `TimeUnixMs`
       * partition-pruning hint like the sibling span reads.
       *
       * These records carry raw captured content (prompts / responses) in their
       * `body`, so — exactly like the sibling span reads — the read is gated behind
       * the viewer's captured-input / captured-output visibility via
       * `redactTraceLogContent`, or the raw-log procedure would be a bypass of
       * the data-privacy policy the span endpoints enforce.
       */
      traceLogs: policy("traces:view")(
        procedure.input(
          z.object({
            projectId: z.string(),
            traceId: z.string(),
            ...spanReadHintShape,
          }),
        ),
      ).query(async ({ input, ctx }): Promise<TraceLogRecordDto[]> => {
        // The free-plan teaser window and the viewer's captured-content
        // permissions are both applied inside the loader, which the transcript
        // endpoint shares — so the two reads cannot diverge on what they hide.
        const protections = await ports.getViewerProtections(ctx, {
          projectId: input.projectId,
        });
        return loadTraceLogsWithProtections({
          app: ctx.app,
          ports,
          projectId: input.projectId,
          traceId: input.traceId,
          ...occurredAtFromInput(input),
          protections,
          codingAgents: ctx.app.codingAgents,
        });
      }),
    });
  }
}
