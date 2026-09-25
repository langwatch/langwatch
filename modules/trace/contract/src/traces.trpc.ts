/**
 * Traces procedures, declared once — the explorer's reads merged with the
 * legacy list/detail reads (merge-traces-v2). Anonymous reads are in
 * sharedTrace (ADR-057); getSampleTraces stays on the API.
 */
import { sharedFiltersInputSchema } from "@langwatch/analytics-contract";
import { defineTrpcContract } from "@langwatch/api/contract";
import { resolveRequestBound } from "@langwatch/plans";
import { z } from "zod";

import { aiActionResultSchema, aiQueryResultSchema } from "./trace-ai-query.ts";
import { evaluationSchema, traceSchema } from "./trace-format.schemas.ts";
import { explorerInstantEvalRunsSchema } from "./trace-instant-eval.schemas.ts";
import { discoverResultSchema, facetValuesResultSchema } from "./trace-list-view.ts";
import {
  customersAndLabelsResultSchema,
  distinctFieldNamesResultSchema,
  namedTopicCountsSchema,
  tracesForProjectResultSchema,
} from "./trace-read.contract.ts";
import { routeSearchInputSchema, routeSearchResultSchema } from "./trace-search-route.ts";
import {
  spanDetailSchema,
  traceHeaderSchema,
  traceResourceInfoSchema,
} from "./trace-view.contract.ts";
import {
  spanTreeDeltaTransportInputSchema,
  spanTreeTransportInputSchema,
} from "./trace.queries.ts";
import {
  tracesChangedNameSchema,
  tracesConversationContextSchema,
  tracesEvaluationRunsSchema,
  tracesListEventsSchema,
  tracesListPageSchema,
  tracesNewCountSchema,
  tracesSessionsPageSchema,
  tracesSpanDetailsSchema,
  tracesSpanLangwatchSignalsSchema,
  tracesSpansDeltaSchema,
  tracesSpansPageSchema,
  tracesSpanTreeNodesSchema,
  tracesSuggestSchema,
  tracesTraceEventsSchema,
  tracesTraceLogsSchema,
} from "./trace.responses.ts";
import { spanTreePageSchema } from "./trace.ts";

/**
 * The outer validation shell is the registry's enterprise ceiling; the
 * tier-effective value (free 1000 / paid 2000 / enterprise 4000) is enforced
 * where the organization's plan is known, in the trace application.
 */
const TRACES_PAGE_SIZE_MAX = resolveRequestBound("tracesPageSizeMax", "ENTERPRISE");
const TRACE_IDS_MAX = resolveRequestBound("traceIdsMax", "ENTERPRISE");

/**
 * Offset pagination was dropped for ClickHouse (deep OFFSET degrades badly;
 * keyset `scrollId` replaced it). Kept on the schema so sending it produces
 * an explanatory error, not silent discard.
 */
const pageOffsetInput = z
  .number()
  .optional()
  .describe(
    "Removed. Offset pagination is no longer supported and any value other " +
      "than 0 is rejected. Page with the scrollId returned by the previous " +
      "response instead. The field remains on the schema so that sending it " +
      "produces an explanatory error rather than being silently discarded.",
  )
  .refine((value) => value === undefined || value === 0, {
    message:
      "pageOffset is no longer supported - offset pagination was removed. Use the scrollId returned by the previous response to fetch the next page.",
  });

/** What a legacy trace read may be scoped by, and what a caller may send. */
export const traceFilterInputSchema = z.object({
  ...sharedFiltersInputSchema.shape,
  pageOffset: pageOffsetInput,
  // Non-negative integers only (#2163): a fractional or negative page size
  // reaches ClickHouse as a LIMIT and fails there instead of at the boundary.
  // The ceiling is the registry's enterprise tier; the application clamps to
  // the caller's tier.
  pageSize: z.number().int().positive().max(TRACES_PAGE_SIZE_MAX).optional(),
});

/** The same, plus the paging and ordering the list/search read understands. */
export const traceListInputSchema = z.object({
  ...traceFilterInputSchema.shape,
  groupBy: z.string().optional(),
  sortBy: z.string().optional(),
  sortDirection: z.string().optional(),
  updatedAt: z.number().optional(),
  scrollId: z.string().optional().nullable(),
});

/**
 * Opt-in for reviewer corrections. Default false so every existing consumer
 * (evaluations, exports, automations, the REST surface) keeps reading exactly
 * what was ingested; only the add-to-dataset flow asks for the corrected trace.
 */
const withEditOverlayInput = z.boolean().default(false);

const traceScopeSchema = z.object({ projectId: z.string(), traceId: z.string() });

const sampleExtrasSchema = z.object({ sortBy: z.string().optional() });

const downloadExtrasSchema = z.object({ includeSpans: z.boolean() });

const timeRangeSchema = z.object({
  from: z.number(),
  to: z.number(),
  live: z.boolean().optional(),
});

const sortSchema = z.object({
  columnId: z.string(),
  direction: z.enum(["asc", "desc"]),
});

/**
 * Ceiling on one `listEvents` call, matching the list's largest page size.
 * The read is a primary-key `IN` over `(TenantId, TraceId, SpanId)`, so it
 * scales with the page rather than the project — but only if the page does.
 */
const MAX_LIST_EVENT_TRACE_IDS = 1000;

/**
 * Reusable Zod fields for span-read endpoints that accept the
 * partition-pruning hint the drawer carries in the URL. Spread into a
 * procedure's input shape with `...`.
 */
const spanReadHintShape = {
  occurredAtMs: z.number().int().optional(),
} as const;

export const tracesTrpc = defineTrpcContract("traces")
  .query("getAllForProject")
  .withInput(traceListInputSchema)
  .withOutput(tracesForProjectResultSchema)

  .query("getById")
  .withInput(z.object({ ...traceScopeSchema.shape, withEditOverlay: withEditOverlayInput }))
  .withOutput(traceSchema)

  .query("getEvaluations")
  .withInput(traceScopeSchema)
  .withOutput(evaluationSchema.array().optional())

  /**
   * Protected (not public-share): keyed by evaluationId, which is only
   * tenant-scoped, so a share token could otherwise read any evaluation's
   * inputs in the project by supplying another id. Stays project-gated.
   */
  .query("getEvaluationInputs")
  .withInput(z.object({ projectId: z.string(), evaluationId: z.string() }))
  .withOutput(z.record(z.string(), z.unknown()).nullable())

  .query("getEvaluationsMultiple")
  .withInput(z.object({ projectId: z.string(), traceIds: z.array(z.string()).max(TRACE_IDS_MAX) }))
  .withOutput(z.record(z.string(), evaluationSchema.array()))

  .query("getTopicCounts")
  .withInput(traceFilterInputSchema)
  .withOutput(namedTopicCountsSchema)

  .query("getCustomersAndLabels")
  .withInput(traceFilterInputSchema)
  .withOutput(customersAndLabelsResultSchema)

  .query("getTracesByThreadId")
  .withInput(z.object({ projectId: z.string(), threadId: z.string() }))
  .withOutput(traceSchema.array())

  .query("getTracesWithSpans")
  .withInput(
    z.object({
      projectId: z.string(),
      traceIds: z.array(z.string()).max(TRACE_IDS_MAX),
      withEditOverlay: withEditOverlayInput,
    }),
  )
  .withOutput(traceSchema.array())

  .query("getFormattedSpansDigest")
  .withInput(
    z.object({
      projectId: z.string(),
      traceIds: z.array(z.string()).max(TRACE_IDS_MAX),
      withEditOverlay: withEditOverlayInput,
    }),
  )
  .withOutput(z.record(z.string(), z.string()))

  .query("getTracesWithSpansByThreadIds")
  .withInput(
    z.object({
      projectId: z.string(),
      threadIds: z.array(z.string()).max(TRACE_IDS_MAX),
      withEditOverlay: withEditOverlayInput,
    }),
  )
  .withOutput(traceSchema.array())

  .query("getSampleTracesDataset")
  .withInput(z.object({ ...traceFilterInputSchema.shape, ...sampleExtrasSchema.shape }))
  .withOutput(traceSchema.array())

  // Loose where main named evaluator's schemas: evaluator-contract depends on this package.
  .query("getSampleTraces")
  .withInput(
    z.object({
      ...traceFilterInputSchema.shape,
      ...sampleExtrasSchema.shape,
      query: z.string().optional(),
      evaluatorType: z.string(),
      preconditions: z.array(z.unknown()),
      expectedResults: z.number(),
    }),
  )
  .withOutput(z.object({ ...traceSchema.shape, passesPreconditions: z.boolean() }).array())

  .query("getFieldNames")
  .withInput(z.object({ projectId: z.string(), startDate: z.number(), endDate: z.number() }))
  .withOutput(distinctFieldNamesResultSchema)

  .mutation("getAllForDownload")
  .withInput(z.object({ ...traceListInputSchema.shape, ...downloadExtrasSchema.shape }))
  .withOutput(tracesForProjectResultSchema)

  /**
   * The stream carries the process's own `trace_updated` broadcast payload
   * verbatim, which this feature does not shape.
   */
  .subscription("onTraceUpdate")
  .withInput(z.object({ projectId: z.string() }))
  .withOutput(z.unknown())

  // ---------------------------------------------------------------------
  // The explorer's grid, sidebar and drawer reads (formerly `traces.*`)
  // ---------------------------------------------------------------------

  .query("list")
  .withInput(
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
      evalRuns: explorerInstantEvalRunsSchema,
    }),
  )
  .withOutput(tracesListPageSchema)

  .query("sessions")
  .withInput(
    z.object({
      projectId: z.string(),
      timeRange: timeRangeSchema,
      sort: sortSchema.optional(),
      pageSize: z.number().int().min(1).max(100).default(50),
      cursor: z.string().optional(),
      query: z.string().nullish(),
      evalRuns: explorerInstantEvalRunsSchema,
    }),
  )
  .withOutput(tracesSessionsPageSchema)

  .query("listEvents")
  .withInput(
    z.object({
      projectId: z.string(),
      traceIds: z.array(z.string().min(1)).max(MAX_LIST_EVENT_TRACE_IDS),
      timeRange: timeRangeSchema,
    }),
  )
  .withOutput(tracesListEventsSchema)

  .query("newCount")
  .withInput(
    z.object({
      projectId: z.string(),
      timeRange: timeRangeSchema,
      since: z.number(),
      query: z.string().nullish(),
      evalRuns: explorerInstantEvalRunsSchema,
    }),
  )
  .withOutput(tracesNewCountSchema)

  .query("suggest")
  .withInput(
    z.object({
      projectId: z.string(),
      field: z.string(),
      prefix: z.string(),
      limit: z.number().int().min(1).max(100).default(20),
    }),
  )
  .withOutput(tracesSuggestSchema)

  /**
   * Conversation/thread context for the trace drawer. Bypasses the search
   * query language so conversationIds with arbitrary characters work
   * unconditionally — the server builds a typed WHERE fragment itself.
   */
  .query("conversationContext")
  .withInput(
    z.object({
      projectId: z.string(),
      conversationId: z.string().min(1),
    }),
  )
  .withOutput(tracesConversationContextSchema)

  /**
   * The sidebar's facets: with no `query` field the tenant's cached snapped
   * discovery, with one (empty string included) every facet counted under it in
   * the window the list reads, each exempt from its own terms. ADR-139.
   */
  .query("discover")
  .withInput(
    z.object({
      projectId: z.string(),
      timeRange: timeRangeSchema,
      query: z.string().nullish(),
      evalRuns: explorerInstantEvalRunsSchema,
    }),
  )
  .withOutput(discoverResultSchema)

  /**
   * Pushes `discover_updated` when a tenant's facet payload finishes
   * background refresh, so the client invalidates its TanStack cache and
   * refetches without polling. Mirrors `traces.onTraceUpdate`.
   */
  .subscription("onDiscoverUpdate")
  .withInput(z.object({ projectId: z.string() }))
  .withOutput(z.unknown())

  .query("facetValues")
  .withInput(
    z.object({
      projectId: z.string(),
      timeRange: timeRangeSchema,
      facetKey: z.string(),
      prefix: z.string().optional(),
      limit: z.number().int().min(1).max(1000).default(50),
      offset: z.number().int().min(0).default(0),
    }),
  )
  .withOutput(facetValuesResultSchema)

  /**
   * The AI composer's query translation. `service_unavailable` until a
   * model-invocation capability is wired — see the handoff for the gap.
   */
  .mutation("aiQuery")
  .withInput(
    z.object({
      projectId: z.string(),
      prompt: z.string().min(1).max(2000),
      timeRange: timeRangeSchema,
    }),
  )
  .withOutput(aiQueryResultSchema)

  /**
   * Higher-level AI action — the model picks between filtering and creating
   * a saved lens. `service_unavailable` until a model-invocation capability
   * is wired — see the handoff for the gap.
   */
  .mutation("aiAction")
  .withInput(
    z.object({
      projectId: z.string(),
      prompt: z.string().min(1).max(2000),
      timeRange: timeRangeSchema,
    }),
  )
  .withOutput(aiActionResultSchema)

  /**
   * Enter on a sentence. The client calls this only when the submitted text
   * has bare words; a pure `field:value` query is applied without a call.
   * `service_unavailable` until a model-invocation capability is wired.
   */
  .mutation("routeSearch")
  .withInput(routeSearchInputSchema)
  .withOutput(routeSearchResultSchema)

  .query("header")
  .withInput(
    z.object({
      projectId: z.string(),
      traceId: z.string(),
      occurredAtMs: z.number().int().optional(),
      full: z.boolean().default(true),
    }),
  )
  .withOutput(traceHeaderSchema)

  .mutation("changeName")
  .withInput(
    z.object({
      projectId: z.string(),
      traceId: z.string(),
      newName: z.string(),
    }),
  )
  .withOutput(tracesChangedNameSchema)

  .query("evals")
  .withInput(
    z.object({
      projectId: z.string(),
      traceId: z.string(),
    }),
  )
  .withOutput(tracesEvaluationRunsSchema)

  .query("traceLogs")
  .withInput(
    z.object({
      projectId: z.string(),
      traceId: z.string(),
      ...spanReadHintShape,
    }),
  )
  .withOutput(tracesTraceLogsSchema)

  .query("spansPaginated")
  .withInput(
    z.object({
      projectId: z.string(),
      traceId: z.string(),
      limit: z.number().int().min(1).max(1000).default(250),
      offset: z.number().int().min(0).default(0),
      ...spanReadHintShape,
    }),
  )
  .withOutput(tracesSpansPageSchema)

  .query("spansDelta")
  .withInput(
    z.object({
      projectId: z.string(),
      traceId: z.string(),
      sinceStartTimeMs: z.number(),
      ...spanReadHintShape,
    }),
  )
  .withOutput(tracesSpansDeltaSchema)

  /**
   * One page of the span tree in `(startTimeMs, spanId)` order. Traces can
   * carry 20k-100k+ spans, so the client assembles the tree page by page.
   * `nextCursor` is null on the final page.
   */
  .query("spanTreePaginated")
  .withInput(spanTreeTransportInputSchema)
  .withOutput(spanTreePageSchema)

  /**
   * Spans of a live trace newer than `sinceUpdatedAtMs`, keyed on row
   * version rather than span start so an in-place update (end time,
   * duration, status, cost) is picked up too.
   */
  .query("spanTreeDelta")
  .withInput(spanTreeDeltaTransportInputSchema)
  .withOutput(tracesSpanTreeNodesSchema)

  /**
   * Whole-tree read in one response. The frontend no longer fetches the
   * tree through this — `spanTreePaginated` pages instead — but this stays
   * as that cache entry's type/key anchor.
   */
  .query("spanTree")
  .withInput(
    z.object({
      projectId: z.string(),
      traceId: z.string(),
      ...spanReadHintShape,
    }),
  )
  .withOutput(tracesSpanTreeNodesSchema)

  /**
   * Per-span LangWatch instrumentation signals (prompt, scenario, user,
   * thread, evaluation, rag, metadata, genai) — fired secondarily so the
   * primary `spanTree` query stays cheap.
   */
  .query("spanLangwatchSignals")
  .withInput(
    z.object({
      projectId: z.string(),
      traceId: z.string(),
      ...spanReadHintShape,
    }),
  )
  .withOutput(tracesSpanLangwatchSignalsSchema)

  /**
   * Full span data for every span in a trace — used by the LLM Optimized
   * Trace markdown view to render per-span attributes and input/output.
   * Heavier than spanTree; fetch lazily.
   */
  .query("spansFull")
  .withInput(
    z.object({
      projectId: z.string(),
      traceId: z.string(),
      ...spanReadHintShape,
    }),
  )
  .withOutput(tracesSpanDetailsSchema)

  .query("spanDetail")
  .withInput(
    z.object({
      projectId: z.string(),
      traceId: z.string(),
      spanId: z.string(),
      ...spanReadHintShape,
    }),
  )
  .withOutput(spanDetailSchema)

  /**
   * OTel resource attributes + instrumentation scope per span. Surfaced in
   * the drawer's metadata section and as the "scope" chip on traces and
   * spans. Standard span mapping drops both, so this reads them raw.
   */
  .query("resourceInfo")
  .withInput(
    z.object({
      projectId: z.string(),
      traceId: z.string(),
      ...spanReadHintShape,
    }),
  )
  .withOutput(traceResourceInfoSchema)

  /**
   * Trace-level events ({spanId, timestamp, name, attributes}) for the
   * drawer. Split off the header so the header stays a pure summary read.
   */
  .query("traceEvents")
  .withInput(
    z.object({
      projectId: z.string(),
      traceId: z.string(),
      ...spanReadHintShape,
    }),
  )
  .withOutput(tracesTraceEventsSchema)

  .build();
