/**
 * TracesV2 procedures for trace explorer UI. Some fields (changeMetadata,
 * coding agent schemas) are NOT declared here due to dependency issues; see
 * `.claude/handoffs/traces-v2-trpc-contract.md` for the fix.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import { discoverResultSchema, facetValuesResultSchema, traceListFacetCountsSchema } from "./trace-list-view.ts";
import { spanDetailSchema, traceHeaderSchema, traceResourceInfoSchema } from "./trace-view.contract.ts";
import {
  tracesV2ChangedNameSchema,
  tracesV2ConversationContextSchema,
  tracesV2EvaluationRunsSchema,
  tracesV2ListEventsSchema,
  tracesV2ListPageSchema,
  tracesV2NewCountSchema,
  tracesV2SessionsPageSchema,
  tracesV2SpanDetailsSchema,
  tracesV2SpanLangwatchSignalsSchema,
  tracesV2SpansDeltaSchema,
  tracesV2SpansPageSchema,
  tracesV2SpanTreeNodesSchema,
  tracesV2SuggestSchema,
  tracesV2TraceEventsSchema,
  tracesV2TraceLogsSchema,
} from "./trace.responses.ts";
import { spanTreeDeltaTransportInputSchema, spanTreeTransportInputSchema } from "./trace.queries.ts";
import { spanTreePageSchema } from "./trace.ts";
import { aiActionResultSchema, aiQueryResultSchema } from "./trace-ai-query.ts";

/**
 * Ceiling on one `listEvents` call, matching the list's largest page size.
 * The read is a primary-key `IN` over `(TenantId, TraceId, SpanId)`, so it
 * scales with the page rather than the project — but only if the page does.
 */
const MAX_LIST_EVENT_TRACE_IDS = 1000;

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
 * Reusable Zod fields for span-read endpoints that accept the
 * partition-pruning hint the drawer carries in the URL. Spread into a
 * procedure's input shape with `...`.
 */
const spanReadHintShape = {
  occurredAtMs: z.number().int().optional(),
} as const;

export const tracesV2Trpc = defineTrpcContract("tracesV2")
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
    }),
  )
  .withOutput(tracesV2ListPageSchema)

  .query("sessions")
  .withInput(
    z.object({
      projectId: z.string(),
      timeRange: timeRangeSchema,
      sort: sortSchema.optional(),
      pageSize: z.number().int().min(1).max(100).default(50),
      cursor: z.string().optional(),
      query: z.string().nullish(),
    }),
  )
  .withOutput(tracesV2SessionsPageSchema)

  .query("listEvents")
  .withInput(
    z.object({
      projectId: z.string(),
      traceIds: z.array(z.string().min(1)).max(MAX_LIST_EVENT_TRACE_IDS),
      timeRange: timeRangeSchema,
    }),
  )
  .withOutput(tracesV2ListEventsSchema)

  .query("facets")
  .withInput(
    z.object({
      projectId: z.string(),
      timeRange: timeRangeSchema,
      query: z.string().nullish(),
    }),
  )
  .withOutput(traceListFacetCountsSchema)

  .query("newCount")
  .withInput(
    z.object({
      projectId: z.string(),
      timeRange: timeRangeSchema,
      since: z.number(),
      query: z.string().nullish(),
    }),
  )
  .withOutput(tracesV2NewCountSchema)

  .query("suggest")
  .withInput(
    z.object({
      projectId: z.string(),
      field: z.string(),
      prefix: z.string(),
      limit: z.number().int().min(1).max(100).default(20),
    }),
  )
  .withOutput(tracesV2SuggestSchema)

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
  .withOutput(tracesV2ConversationContextSchema)

  .query("discover")
  .withInput(
    z.object({
      projectId: z.string(),
      timeRange: timeRangeSchema,
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
   * a saved lens, so a user can say "save as Failing GPT-4" or "show errors"
   * and get the right one applied.
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
  .withOutput(tracesV2ChangedNameSchema)

  .query("evals")
  .withInput(
    z.object({
      projectId: z.string(),
      traceId: z.string(),
    }),
  )
  .withOutput(tracesV2EvaluationRunsSchema)

  .query("traceLogs")
  .withInput(
    z.object({
      projectId: z.string(),
      traceId: z.string(),
      ...spanReadHintShape,
    }),
  )
  .withOutput(tracesV2TraceLogsSchema)

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
  .withOutput(tracesV2SpansPageSchema)

  .query("spansDelta")
  .withInput(
    z.object({
      projectId: z.string(),
      traceId: z.string(),
      sinceStartTimeMs: z.number(),
      ...spanReadHintShape,
    }),
  )
  .withOutput(tracesV2SpansDeltaSchema)

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
  .withOutput(tracesV2SpanTreeNodesSchema)

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
  .withOutput(tracesV2SpanTreeNodesSchema)

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
  .withOutput(tracesV2SpanLangwatchSignalsSchema)

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
  .withOutput(tracesV2SpanDetailsSchema)

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
  .withOutput(tracesV2TraceEventsSchema)

  .build();
