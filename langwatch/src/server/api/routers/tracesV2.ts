import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getApp } from "~/server/app-layer/app";
import {
  generateTraceAction,
  generateTraceQueryFromPrompt,
} from "~/server/app-layer/traces/ai-query";
import { TraceNotFoundError } from "~/server/app-layer/traces/errors";
import { translateFilterToClickHouse } from "~/server/app-layer/traces/filter-to-clickhouse";
import type { SpanSummaryRow } from "~/server/app-layer/traces/repositories/span-storage.repository";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { Span, SpanInputOutput } from "~/server/tracer/types";
import { checkProjectPermission } from "../rbac";
import type {
  SpanDetail,
  SpanTreeNode,
  TraceHeader,
  TraceResourceInfoDto,
} from "./tracesV2.schemas";

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
  return input.occurredAtMs !== undefined
    ? { occurredAtMs: input.occurredAtMs }
    : {};
}

// ---------------------------------------------------------------------------
// Mappers – internal types → scoped output models
// ---------------------------------------------------------------------------

function mapTraceSummaryToHeader(summary: TraceSummaryData): TraceHeader {
  const totalTokens =
    (summary.totalPromptTokenCount ?? 0) +
    (summary.totalCompletionTokenCount ?? 0);

  let status: TraceHeader["status"] = "ok";
  if (summary.containsErrorStatus) status = "error";
  else if (!summary.containsOKStatus) status = "warning";

  return {
    traceId: summary.traceId,
    timestamp: summary.occurredAt,
    name:
      summary.attributes["langwatch.span.name"] ?? summary.traceId.slice(0, 8),
    serviceName: summary.attributes["service.name"] ?? "",
    origin: summary.attributes["langwatch.origin"] ?? "application",
    conversationId:
      summary.attributes["gen_ai.conversation.id"] ??
      summary.attributes["langgraph.thread_id"] ??
      null,
    userId: summary.attributes["langwatch.user_id"] ?? null,
    durationMs: summary.totalDurationMs,
    spanCount: summary.spanCount,
    status,
    error: summary.errorMessage,
    input: summary.computedInput,
    output: summary.computedOutput,
    models: summary.models,
    totalCost: summary.totalCost,
    totalTokens,
    inputTokens: summary.totalPromptTokenCount,
    outputTokens: summary.totalCompletionTokenCount,
    tokensEstimated: summary.tokensEstimated,
    ttft: summary.timeToFirstTokenMs,
    rootSpanName: summary.rootSpanName,
    rootSpanType: summary.rootSpanType,
    scenarioRunId: summary.attributes["scenario.run_id"] ?? null,
    containsPrompt: summary.containsPrompt ?? false,
    selectedPromptId: summary.selectedPromptId ?? null,
    selectedPromptSpanId: summary.selectedPromptSpanId ?? null,
    lastUsedPromptId: summary.lastUsedPromptId ?? null,
    lastUsedPromptVersionNumber: summary.lastUsedPromptVersionNumber ?? null,
    lastUsedPromptVersionId: summary.lastUsedPromptVersionId ?? null,
    lastUsedPromptSpanId: summary.lastUsedPromptSpanId ?? null,
    attributes: summary.attributes,
    events: summary.events ?? [],
  };
}

function mapSpanSummaryToTreeNode(row: SpanSummaryRow): SpanTreeNode {
  let status: SpanTreeNode["status"] = "unset";
  if (row.statusCode === 2) status = "error";
  else if (row.statusCode === 1) status = "ok";

  return {
    spanId: row.spanId,
    parentSpanId: row.parentSpanId,
    name: row.spanName,
    type: row.spanType,
    startTimeMs: row.startTimeMs,
    endTimeMs: row.startTimeMs + row.durationMs,
    durationMs: row.durationMs,
    status,
    model: row.model,
  };
}

function stringifySpanIO(
  io: SpanInputOutput | null | undefined,
): string | null {
  if (!io) return null;
  switch (io.type) {
    case "text":
      return String(io.value);
    case "chat_messages":
      return JSON.stringify(io.value);
    case "json":
      return JSON.stringify(io.value);
    case "raw":
      return String(io.value);
    case "guardrail_result":
    case "evaluation_result":
      return JSON.stringify(io.value);
    case "list":
      return io.value.map((v) => stringifySpanIO(v)).join("\n");
    default:
      return null;
  }
}

function mapSpanToDetail(
  span: Span,
  rawEvents: Array<{
    name: string;
    timeUnixMs: number;
    attributes: Record<string, unknown>;
  }>,
): SpanDetail {
  let status: SpanDetail["status"] = "unset";
  if (span.error) status = "error";
  else if (span.timestamps.finished_at > 0) status = "ok";

  return {
    spanId: span.span_id,
    parentSpanId: span.parent_id ?? null,
    name: span.name ?? "(unnamed)",
    type: span.type,
    startTimeMs: span.timestamps.started_at,
    endTimeMs: span.timestamps.finished_at,
    durationMs: span.timestamps.finished_at - span.timestamps.started_at,
    status,
    model: "model" in span ? (span.model ?? null) : null,
    vendor: "vendor" in span ? (span.vendor ?? null) : null,
    input: stringifySpanIO(span.input),
    output: stringifySpanIO(span.output),
    error: span.error
      ? { message: span.error.message, stacktrace: span.error.stacktrace }
      : null,
    metrics: span.metrics
      ? {
          promptTokens: span.metrics.prompt_tokens,
          completionTokens: span.metrics.completion_tokens,
          cost: span.metrics.cost,
          tokensEstimated: span.metrics.tokens_estimated,
        }
      : null,
    params: span.params ?? null,
    events: rawEvents.map((e) => ({
      name: e.name,
      timestampMs: e.timeUnixMs,
      attributes: e.attributes,
    })),
  };
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const timeRangeSchema = z.object({
  from: z.number(),
  to: z.number(),
  live: z.boolean().optional(),
});

const sortSchema = z.object({
  columnId: z.string(),
  direction: z.enum(["asc", "desc"]),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const tracesV2Router = createTRPCRouter({
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        timeRange: timeRangeSchema,
        sort: sortSchema,
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(1000).default(50),
        query: z.string().nullish(),
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }) => {
      const app = getApp();
      const filterWhere = translateFilterToClickHouse(
        input.query ?? "",
        input.projectId,
        input.timeRange,
      );
      return app.traces.list.list({
        tenantId: input.projectId,
        timeRange: input.timeRange,
        sort: input.sort,
        page: input.page,
        pageSize: input.pageSize,
        filterWhere: filterWhere ?? undefined,
      });
    }),

  facets: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        timeRange: timeRangeSchema,
        query: z.string().nullish(),
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }) => {
      const app = getApp();
      const filterWhere = translateFilterToClickHouse(
        input.query ?? "",
        input.projectId,
        input.timeRange,
      );
      return app.traces.list.facets({
        tenantId: input.projectId,
        timeRange: input.timeRange,
        filterWhere: filterWhere ?? undefined,
      });
    }),

  newCount: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        timeRange: timeRangeSchema,
        since: z.number(),
        query: z.string().nullish(),
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }) => {
      const app = getApp();
      const filterWhere = translateFilterToClickHouse(
        input.query ?? "",
        input.projectId,
        input.timeRange,
      );
      const count = await app.traces.list.newCount({
        tenantId: input.projectId,
        timeRange: input.timeRange,
        since: input.since,
        filterWhere: filterWhere ?? undefined,
      });
      return { count };
    }),

  suggest: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        field: z.string(),
        prefix: z.string(),
        limit: z.number().int().min(1).max(100).default(20),
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }) => {
      const app = getApp();
      const values = await app.traces.list.suggest({
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
  conversationContext: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        conversationId: z.string().min(1),
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }) => {
      const app = getApp();
      // Window: conversation membership is timeless; cap at 1y to keep
      // partition pruning effective.
      const now = Date.now();
      const timeRange = { from: now - 365 * 24 * 60 * 60 * 1000, to: now };
      const filterWhere = {
        sql: "Attributes['gen_ai.conversation.id'] = {threadConversationId:String}",
        params: { threadConversationId: input.conversationId },
      };
      const page = await app.traces.list.list({
        tenantId: input.projectId,
        timeRange,
        sort: { columnId: "time", direction: "asc" },
        page: 1,
        pageSize: 200,
        filterWhere,
      });
      const turns = page.items.map((t) => ({
        traceId: t.traceId,
        timestamp: t.timestamp,
        name: t.rootSpanName ?? t.name,
        rootSpanType: t.rootSpanType ?? null,
        status: t.status,
        input: t.input ?? null,
        output: t.output ?? null,
      }));
      // Position/previous/next are derived client-side from the active
      // traceId so the cache key doesn't churn on J/K navigation.
      return {
        conversationId: input.conversationId,
        turns,
        total: turns.length,
      };
    }),

  discover: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        timeRange: timeRangeSchema,
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }) => {
      const app = getApp();
      return app.traces.list.discover({
        tenantId: input.projectId,
        timeRange: input.timeRange,
      });
    }),

  facetValues: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        timeRange: timeRangeSchema,
        facetKey: z.string(),
        prefix: z.string().optional(),
        limit: z.number().int().min(1).max(1000).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }) => {
      const app = getApp();
      return app.traces.list.facetValues({
        tenantId: input.projectId,
        timeRange: input.timeRange,
        facetKey: input.facetKey,
        prefix: input.prefix,
        limit: input.limit,
        offset: input.offset,
      });
    }),

  aiQuery: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        prompt: z.string().min(1).max(2000),
        timeRange: timeRangeSchema,
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .mutation(async ({ input }) => {
      return generateTraceQueryFromPrompt({
        projectId: input.projectId,
        prompt: input.prompt,
        timeRange: { from: input.timeRange.from, to: input.timeRange.to },
      });
    }),

  // Higher-level AI action — the model picks between filtering and creating
  // a saved lens. The composer in the search bar uses this so users can
  // say "save as Failing GPT-4" and get a new tab, or "show errors" and
  // just get a query applied.
  aiAction: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        prompt: z.string().min(1).max(2000),
        timeRange: timeRangeSchema,
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .mutation(async ({ input }) => {
      return generateTraceAction({
        projectId: input.projectId,
        prompt: input.prompt,
        timeRange: { from: input.timeRange.from, to: input.timeRange.to },
      });
    }),

  header: protectedProcedure
    .input(
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
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }): Promise<TraceHeader> => {
      const app = getApp();
      const summary = await app.traces.summary.getByTraceId(
        input.projectId,
        input.traceId,
        input.occurredAtMs !== undefined
          ? { occurredAtMs: input.occurredAtMs }
          : undefined,
      );
      if (!summary) {
        throw new TraceNotFoundError(input.traceId);
      }
      return mapTraceSummaryToHeader(summary);
    }),

  spansPaginated: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        traceId: z.string(),
        limit: z.number().int().min(1).max(1000).default(250),
        offset: z.number().int().min(0).default(0),
        ...spanReadHintShape,
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }) => {
      const app = getApp();
      return app.traces.spans.getSpansPaginated({
        tenantId: input.projectId,
        traceId: input.traceId,
        limit: input.limit,
        offset: input.offset,
        ...occurredAtFromInput(input),
      });
    }),

  spansDelta: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        traceId: z.string(),
        sinceStartTimeMs: z.number(),
        ...spanReadHintShape,
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }) => {
      const app = getApp();
      return app.traces.spans.getSpansSince({
        tenantId: input.projectId,
        traceId: input.traceId,
        sinceStartTimeMs: input.sinceStartTimeMs,
        ...occurredAtFromInput(input),
      });
    }),

  spanTreePaginated: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        traceId: z.string(),
        limit: z.number().int().min(1).max(1000).default(200),
        offset: z.number().int().min(0).default(0),
        ...spanReadHintShape,
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(
      async ({ input }): Promise<{ nodes: SpanTreeNode[]; total: number }> => {
        const app = getApp();
        const result = await app.traces.spans.getSpanSummariesPaginated({
          tenantId: input.projectId,
          traceId: input.traceId,
          limit: input.limit,
          offset: input.offset,
          ...occurredAtFromInput(input),
        });
        return {
          nodes: result.rows.map(mapSpanSummaryToTreeNode),
          total: result.total,
        };
      },
    ),

  spanTreeDelta: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        traceId: z.string(),
        sinceStartTimeMs: z.number(),
        ...spanReadHintShape,
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }): Promise<SpanTreeNode[]> => {
      const app = getApp();
      const rows = await app.traces.spans.getSpanSummariesSince({
        tenantId: input.projectId,
        traceId: input.traceId,
        sinceStartTimeMs: input.sinceStartTimeMs,
        ...occurredAtFromInput(input),
      });
      return rows.map(mapSpanSummaryToTreeNode);
    }),

  spanTree: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        traceId: z.string(),
        ...spanReadHintShape,
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }): Promise<SpanTreeNode[]> => {
      const app = getApp();
      const rows = await app.traces.spans.getSpanSummaryByTraceId({
        tenantId: input.projectId,
        traceId: input.traceId,
        ...occurredAtFromInput(input),
      });
      return rows.map(mapSpanSummaryToTreeNode);
    }),

  /**
   * Full span data for every span in a trace — used by the LLM Optimized
   * Trace markdown view to render per-span attributes and input/output.
   * Heavier than spanTree; fetch lazily.
   */
  spansFull: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        traceId: z.string(),
        ...spanReadHintShape,
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }): Promise<SpanDetail[]> => {
      const app = getApp();
      const spans = await app.traces.spans.getSpansByTraceId({
        tenantId: input.projectId,
        traceId: input.traceId,
        ...occurredAtFromInput(input),
      });
      return spans.map((span) => mapSpanToDetail(span, []));
    }),

  spanDetail: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        traceId: z.string(),
        spanId: z.string(),
        ...spanReadHintShape,
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }): Promise<SpanDetail> => {
      const app = getApp();
      const hint = occurredAtFromInput(input);
      // One narrow span fetch + one narrow events fetch in parallel —
      // both keyed by SpanId (and partition-pruned by occurredAtMs when
      // available). Replaces an older path that pulled every span in the
      // trace into Node memory just to .find() one, plus a third query
      // whose result was never read.
      const [span, rawEvents] = await Promise.all([
        app.traces.spans.getSpanById({
          tenantId: input.projectId,
          traceId: input.traceId,
          spanId: input.spanId,
          ...hint,
        }),
        app.traces.spans.getSpanEvents({
          tenantId: input.projectId,
          traceId: input.traceId,
          spanId: input.spanId,
          ...hint,
        }),
      ]);

      if (!span) {
        throw new TraceNotFoundError(input.spanId);
      }

      return mapSpanToDetail(
        span,
        rawEvents.map((e) => ({
          name: e.event_type,
          timeUnixMs:
            typeof e.timestamps.started_at === "number"
              ? e.timestamps.started_at
              : parseInt(String(e.timestamps.started_at), 10),
          attributes: Object.fromEntries([
            ...e.event_details.map((d) => [d.key, d.value]),
            ...e.metrics.map((m) => [m.key, m.value]),
          ]),
        })),
      );
    }),

  /**
   * OTel resource attributes + instrumentation scope per span. Surfaced in
   * the drawer's metadata section and as the "scope" chip on traces and
   * spans. Standard span mapping drops both, so this reads them raw.
   */
  resourceInfo: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        traceId: z.string(),
        ...spanReadHintShape,
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }): Promise<TraceResourceInfoDto> => {
      const app = getApp();
      const rows = await app.traces.spans.getSpanResourcesByTraceId({
        tenantId: input.projectId,
        traceId: input.traceId,
        ...occurredAtFromInput(input),
      });

      const spans = rows.map((r) => ({
        spanId: r.spanId,
        parentSpanId: r.parentSpanId,
        resourceAttributes: r.resourceAttributes,
        scope: { name: r.scopeName ?? "", version: r.scopeVersion },
      }));

      // Pick the root span (no parent) if present; fall back to earliest.
      const root = rows.find((r) => r.parentSpanId == null) ?? rows[0] ?? null;

      return {
        rootSpanId: root?.spanId ?? null,
        resourceAttributes: root?.resourceAttributes ?? {},
        scope: root
          ? { name: root.scopeName ?? "", version: root.scopeVersion }
          : null,
        spans,
      };
    }),

  events: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        traceId: z.string(),
        ...spanReadHintShape,
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }) => {
      const app = getApp();
      return app.traces.spans.getEventsByTraceId({
        tenantId: input.projectId,
        traceId: input.traceId,
        ...occurredAtFromInput(input),
      });
    }),

  evals: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        traceId: z.string(),
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }) => {
      const app = getApp();
      return app.evaluations.runs.findByTraceId(input.projectId, input.traceId);
    }),
});
