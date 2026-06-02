import type { ClickHouseClient } from "@clickhouse/client";
import type { PrismaClient } from "@prisma/client";
import { getLangWatchTracer } from "langwatch";
import type { TraceWithGuardrail } from "~/components/messages/MessageCard";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import { prisma as defaultPrisma } from "~/server/db";
import type { Protections } from "~/server/elasticsearch/protections";
import {
  mapClickHouseEvaluationToTraceEvaluation,
  mapTraceEvaluationsToLegacyEvaluations,
  type ClickHouseEvaluationRunRow,
} from "~/server/evaluations/evaluation-run.mappers";
import type {
  NormalizedSpan,
  NormalizedSpanKind,
  NormalizedStatusCode,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import { generateClickHouseFilterConditions } from "~/server/filters/clickhouse";
import type { Span, Trace } from "~/server/tracer/types";
import { LLM_PARAMETER_MAP } from "~/prompts/prompt-playground/llmParameterMap";
import { createLogger } from "~/utils/logger/server";
import {
  applyTraceProtections,
  mapNormalizedSpansToSpans,
  mapTraceSummaryToTrace,
} from "./mappers";
import { findPromptReferenceInAncestors } from "./findPromptReferenceInAncestors";
import { parseLLMSpanMessages } from "./parseLLMSpanMessages";
import { parsePromptReference } from "./parsePromptReference";
import type { ExtractedIO } from "~/server/app-layer/traces/trace-io-extraction.service";
import type { ResolvedTraceSpans } from "./resolve-offloaded-traces";
import type {
  AggregationFiltersInput,
  CustomersAndLabelsResult,
  DistinctFieldNamesResult,
  GetAllTracesForProjectInput,
  PromptStudioSpanResult,
  TopicCountsResult,
  TracesForProjectResult,
} from "./types";

/**
 * Callback injected from TraceService that resolves offloaded blob refs for
 * a single trace's normalized spans (ADR-021 decision B: read-time recompute).
 * When present, called after fetching spans but before mapping to legacy Span.
 */
export type ResolveTraceSpansFn = (
  projectId: string,
  normalizedSpans: NormalizedSpan[],
) => Promise<ResolvedTraceSpans>;

/**
 * Cursor structure for keyset pagination.
 * Encoded as base64 JSON in the scrollId.
 */
interface ClickHouseScrollCursor {
  /** Last seen timestamp (CreatedAt) */
  lastTimestamp: number;
  /** Last seen trace ID for tie-breaking */
  lastTraceId: string;
  /** Page size for consistency */
  pageSize: number;
  /** Sort direction */
  sortDirection: "asc" | "desc";
}

/**
 * Service for fetching traces from ClickHouse.
 *
 * Fetches trace summaries and, when needed, span rows via separate ClickHouse
 * queries, combines them in application code, and maps to legacy Trace/Span types.
 */
export class ClickHouseTraceService {
  private readonly logger = createLogger("langwatch:traces:clickhouse-service");
  private readonly tracer = getLangWatchTracer(
    "langwatch.traces.clickhouse-service",
  );

  /**
   * Optional callback that resolves offloaded blob refs for a single trace's
   * normalized spans before they are mapped to legacy Span objects. Injected
   * from TraceService so blob-resolution deps are owned at a single composition
   * point. When absent, spans are mapped as-is (preview values remain).
   */
  private readonly resolveTraceSpans: ResolveTraceSpansFn | undefined;

  constructor(
    private readonly prisma: PrismaClient,
    resolveTraceSpans?: ResolveTraceSpansFn,
  ) {
    this.resolveTraceSpans = resolveTraceSpans;
  }

  /**
   * Resolve the ClickHouse client for a given project.
   *
   * The returned client is already wrapped with wrapWithDefaultSettings
   * by getClickHouseClientForProject, so every query automatically receives
   * memory-safety limits (max_memory_usage, max_bytes_before_external_group_by).
   */
  private async resolveClient(projectId: string) {
    return getClickHouseClientForProject(projectId);
  }

  /**
   * Static factory method for creating ClickHouseTraceService with default dependencies.
   */
  static create(
    prisma: PrismaClient = defaultPrisma,
    resolveTraceSpans?: ResolveTraceSpansFn,
  ): ClickHouseTraceService {
    return new ClickHouseTraceService(prisma, resolveTraceSpans);
  }

  /**
   * Get traces with spans for the given trace IDs.
   *
   * Returns null if:
   * - ClickHouse client is not available
   * - ClickHouse is not enabled for this project
   *
   * @param projectId - The project ID
   * @param traceIds - Array of trace IDs to fetch
   * @param protections - Field redaction protections
   * @returns Array of Trace objects with spans, or null if ClickHouse is not enabled
   */
  async getTracesWithSpans(
    projectId: string,
    traceIds: string[],
    protections: Protections,
  ): Promise<Trace[] | null> {
    return await this.tracer.withActiveSpan(
      "ClickHouseTraceService.getTracesWithSpans",
      {
        attributes: { "tenant.id": projectId },
      },
      async () => {
        const clickHouseClient = await this.resolveClient(projectId);
        if (!clickHouseClient) {
          return null;
        }

        if (traceIds.length === 0) {
          return [];
        }

        this.logger.debug(
          { projectId, traceIdCount: traceIds.length },
          "Fetching traces with spans from ClickHouse",
        );

        try {
          // Fetch trace summaries with spans using JOIN
          const tracesWithSpans = await this.fetchTracesWithSpansJoined(
            projectId,
            traceIds,
          );

          // Map to legacy Trace format and apply protections
          const traces: Trace[] = [];
          for (const [_traceId, { summary, spans }] of tracesWithSpans) {
            const trace = await this.resolveAndMerge({
              projectId,
              summary,
              spans,
              protections,
            });
            traces.push(trace);
          }

          this.logger.debug(
            { projectId, traceCount: traces.length },
            "Successfully fetched traces from ClickHouse",
          );

          return traces;
        } catch (error) {
          this.logger.error(
            {
              projectId,
              error: error instanceof Error ? error.message : error,
            },
            "Failed to fetch traces from ClickHouse",
          );
          throw new Error("Failed to fetch traces with spans");
        }
      },
    );
  }

  /**
   * Resolve a trace ID prefix to matching full trace IDs within a project.
   *
   * Used for git-style shortcut lookups where a user provides a prefix of the
   * full trace ID (for example, the 20-char truncated ID shown by `langwatch
   * trace search`). Returns up to `limit` distinct trace IDs so the caller can
   * detect ambiguity.
   *
   * Callers MUST pass an `occurredAt` range to keep the scan bounded. Per
   * repository conventions, filtering on the partition key (OccurredAt) is
   * required — without it ClickHouse scans every partition (including cold
   * S3 storage) for every lookup miss.
   *
   * Returns null if the ClickHouse client is not available for the project.
   */
  async resolveTraceIdByPrefix({
    projectId,
    prefix,
    occurredAt,
    limit = 2,
  }: {
    /** The project ID (scoped via TenantId) */
    projectId: string;
    /** The trace ID prefix to search for */
    prefix: string;
    /** Partition-key bound (epoch millis) — required for partition pruning */
    occurredAt: { from: number; to: number };
    /** Maximum distinct trace IDs to return (default 2 — enough to detect ambiguity) */
    limit?: number;
  }): Promise<string[] | null> {
    return await this.tracer.withActiveSpan(
      "ClickHouseTraceService.resolveTraceIdByPrefix",
      { attributes: { "tenant.id": projectId, "trace.id.prefix": prefix } },
      async () => {
        const clickHouseClient = await this.resolveClient(projectId);
        if (!clickHouseClient) {
          return null;
        }

        try {
          const result = await clickHouseClient.query({
            query: `
              SELECT DISTINCT TraceId
              FROM trace_summaries
              WHERE TenantId = {tenantId:String}
                AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
                AND OccurredAt <= fromUnixTimestamp64Milli({toMs:Int64})
                AND startsWith(TraceId, {prefix:String})
              LIMIT {limit:UInt32}
            `,
            query_params: {
              tenantId: projectId,
              fromMs: occurredAt.from,
              toMs: occurredAt.to,
              prefix,
              limit,
            },
            format: "JSONEachRow",
          });

          const rows = (await result.json()) as Array<{ TraceId: string }>;
          return rows.map((r) => r.TraceId);
        } catch (error) {
          this.logger.error(
            {
              projectId,
              prefix,
              error: error instanceof Error ? error.message : error,
            },
            "Failed to resolve trace ID by prefix from ClickHouse",
          );
          throw new Error("Failed to resolve trace ID by prefix");
        }
      },
    );
  }

  /**
   * Get traces by thread ID.
   *
   * Queries trace_summaries using the Attributes map to find traces
   * with matching thread_id (stored under various attribute keys).
   *
   * Returns null if:
   * - ClickHouse client is not available
   * - ClickHouse is not enabled for this project
   *
   * @param projectId - The project ID
   * @param threadId - The thread ID to search for
   * @param protections - Field redaction protections
   * @returns Array of Trace objects, or null if ClickHouse is not enabled
   */
  async getTracesByThreadId(
    projectId: string,
    threadId: string,
    protections: Protections,
  ): Promise<Trace[] | null> {
    return await this.tracer.withActiveSpan(
      "ClickHouseTraceService.getTracesByThreadId",
      {
        attributes: { "tenant.id": projectId, "thread.id": threadId },
      },
      async () => {
        const clickHouseClient = await this.resolveClient(projectId);
        if (!clickHouseClient) {
          return null;
        }

        this.logger.debug(
          { projectId, threadId },
          "Fetching traces by thread ID from ClickHouse",
        );

        try {
          // Query trace_summaries for traces with matching thread_id
          // Thread ID can be stored under different attribute keys
          const result = await clickHouseClient.query({
            query: `
              SELECT DISTINCT TraceId
              FROM trace_summaries
              WHERE TenantId = {tenantId:String}
                AND Attributes['gen_ai.conversation.id'] = {threadId:String}
              ORDER BY CreatedAt ASC
              LIMIT 1000
            `,
            query_params: {
              tenantId: projectId,
              threadId,
            },
            format: "JSONEachRow",
          });

          const rows = (await result.json()) as Array<{ TraceId: string }>;
          const traceIds = rows.map((r) => r.TraceId);

          if (traceIds.length === 0) {
            return [];
          }

          // Fetch full traces with spans
          const traces = await this.getTracesWithSpans(
            projectId,
            traceIds,
            protections,
          );
          if (!traces) return null;

          // Re-sort by timestamp — getTracesWithSpans returns in TraceId
          // order which doesn't match the chronological order we need.
          traces.sort(
            (a, b) =>
              (a.timestamps.started_at ?? 0) - (b.timestamps.started_at ?? 0),
          );
          return traces;
        } catch (error) {
          this.logger.error(
            {
              projectId,
              threadId,
              error: error instanceof Error ? error.message : error,
            },
            "Failed to fetch traces by thread ID from ClickHouse",
          );
          throw new Error("Failed to fetch traces by thread ID");
        }
      },
    );
  }

  /**
   * Get traces with spans by multiple thread IDs.
   *
   * Queries trace_summaries using the Attributes map to find traces
   * with matching thread_ids (stored under various attribute keys).
   *
   * Returns null if:
   * - ClickHouse client is not available
   * - ClickHouse is not enabled for this project
   *
   * @param projectId - The project ID
   * @param threadIds - Array of thread IDs to search for
   * @param protections - Field redaction protections
   * @returns Array of Trace objects with spans, or null if ClickHouse is not enabled
   */
  async getTracesWithSpansByThreadIds(
    projectId: string,
    threadIds: string[],
    protections: Protections,
  ): Promise<Trace[] | null> {
    return await this.tracer.withActiveSpan(
      "ClickHouseTraceService.getTracesWithSpansByThreadIds",
      {
        attributes: {
          "tenant.id": projectId,
          "thread.count": threadIds.length,
        },
      },
      async () => {
        const clickHouseClient = await this.resolveClient(projectId);
        if (!clickHouseClient) {
          return null;
        }

        if (threadIds.length === 0) {
          return [];
        }

        this.logger.debug(
          { projectId, threadIdCount: threadIds.length },
          "Fetching traces by thread IDs from ClickHouse",
        );

        try {
          // Query trace_summaries for traces with matching thread_ids
          // Thread ID can be stored under different attribute keys
          const result = await clickHouseClient.query({
            query: `
              SELECT DISTINCT TraceId
              FROM trace_summaries
              WHERE TenantId = {tenantId:String}
                AND Attributes['gen_ai.conversation.id'] IN ({threadIds:Array(String)})
              ORDER BY CreatedAt ASC
              LIMIT 1000
            `,
            query_params: {
              tenantId: projectId,
              threadIds,
            },
            format: "JSONEachRow",
          });

          const rows = (await result.json()) as Array<{ TraceId: string }>;
          const traceIds = rows.map((r) => r.TraceId);

          if (traceIds.length === 0) {
            return [];
          }

          // Fetch full traces with spans
          const traces = await this.getTracesWithSpans(
            projectId,
            traceIds,
            protections,
          );
          if (!traces) return null;

          // Re-sort by timestamp — getTracesWithSpans returns in TraceId
          // order which doesn't match the chronological order we need.
          traces.sort(
            (a, b) =>
              (a.timestamps.started_at ?? 0) - (b.timestamps.started_at ?? 0),
          );
          return traces;
        } catch (error) {
          this.logger.error(
            {
              projectId,
              threadIds,
              error: error instanceof Error ? error.message : error,
            },
            "Failed to fetch traces by thread IDs from ClickHouse",
          );
          throw new Error("Failed to fetch traces by thread IDs");
        }
      },
    );
  }

  /**
   * Get all traces for a project with filtering and pagination.
   *
   * Uses keyset pagination for efficient cursor-based scrolling.
   * The scrollId encodes the last-seen (timestamp, traceId) pair.
   *
   * Returns null if:
   * - ClickHouse client is not available
   * - ClickHouse is not enabled for this project
   *
   * @param input - Query parameters including filters, pagination, and sorting
   * @param protections - Field redaction protections
   * @returns TracesForProjectResult or null if ClickHouse is not enabled
   */
  async getAllTracesForProject(
    input: GetAllTracesForProjectInput,
    protections: Protections,
    options: {
      includeSpans?: boolean;
      scrollId?: string | null;
    } = {},
  ): Promise<TracesForProjectResult | null> {
    return await this.tracer.withActiveSpan(
      "ClickHouseTraceService.getAllTracesForProject",
      async (_span) => {
        const clickHouseClient = await this.resolveClient(input.projectId);
        if (!clickHouseClient) {
          return null;
        }

        try {
          const pageSize = input.pageSize ?? 25;
          const sortDirection =
            (input.sortDirection as "asc" | "desc") ?? "desc";

          // Parse cursor from scrollId if present (matches ES service contract)
          let cursor: ClickHouseScrollCursor | null = null;
          if (options.scrollId) {
            this.logger.debug(
              { scrollId: options.scrollId },
              "Parsing scrollId from request",
            );
            try {
              cursor = JSON.parse(
                Buffer.from(options.scrollId, "base64").toString("utf-8"),
              );

              // Validate that cursor parameters match current request
              if (cursor && cursor.sortDirection !== sortDirection) {
                this.logger.warn(
                  {
                    cursorSortDirection: cursor.sortDirection,
                    requestSortDirection: sortDirection,
                  },
                  "Sort direction mismatch in cursor, ignoring cursor",
                );
                cursor = null;
              } else if (cursor && cursor.pageSize !== pageSize) {
                this.logger.warn(
                  {
                    cursorPageSize: cursor.pageSize,
                    requestPageSize: pageSize,
                  },
                  "Page size mismatch in cursor, ignoring cursor",
                );
                cursor = null;
              }

              this.logger.debug(
                {
                  cursorParsed: !!cursor,
                  cursorLastTimestamp: cursor?.lastTimestamp,
                  cursorLastTraceId: cursor?.lastTraceId,
                  cursorSortDirection: cursor?.sortDirection,
                  cursorPageSize: cursor?.pageSize,
                },
                "Cursor parsing and validation result",
              );
            } catch (e) {
              this.logger.warn(
                {
                  scrollId: options.scrollId,
                  error: e instanceof Error ? e.message : e,
                },
                "Invalid scrollId, starting from beginning",
              );
            }
          } else {
            this.logger.debug("No scrollId provided in request");
          }

          // Generate filter conditions from input.filters
          const {
            conditions: filterConditions,
            params: filterParams,
            hasUnsupportedFilters,
          } = generateClickHouseFilterConditions(input.filters ?? {});

          if (hasUnsupportedFilters) {
            throw new Error(
              "Filters contain unsupported fields for ClickHouse",
            );
          }

          // Build the query with keyset pagination
          let { traces, totalHits, lastTrace } =
            await this.fetchTracesWithPagination({
              projectId: input.projectId,
              pageSize,
              sortDirection,
              cursor,
              protections,
              startDate: input.startDate,
              endDate: input.endDate,
              filterConditions,
              filterParams,
              traceIds: input.traceIds,
              query: input.query,
            });

          // When includeSpans is requested, fetch and attach actual spans
          if (options.includeSpans && traces.length > 0) {
            traces = await this.enrichTracesWithSpans(
              traces,
              input.projectId,
              protections,
            );
          }

          // Generate new scrollId from last trace
          let newScrollId: string | undefined;
          if (lastTrace && traces.length === pageSize) {
            const newCursor: ClickHouseScrollCursor = {
              lastTimestamp: lastTrace.timestamps.started_at,
              lastTraceId: lastTrace.trace_id,
              pageSize,
              sortDirection,
            };
            newScrollId = Buffer.from(JSON.stringify(newCursor)).toString(
              "base64",
            );

            this.logger.debug(
              {
                lastTraceTimestamp: lastTrace.timestamps.started_at,
                lastTraceId: lastTrace.trace_id,
                tracesCount: traces.length,
                pageSize,
                newScrollId,
              },
              "Generated new scrollId",
            );
          }

          // Group traces (for now, single-trace groups unless groupBy is specified)
          const rawGroups = this.groupTraces(traces, input.groupBy);

          // Transform traces to include guardrail information
          const groups = rawGroups.map((group) =>
            transformTracesWithGuardrails(group),
          );

          this.logger.debug(
            {
              tracesReturned: traces.length,
              totalHits,
              hasScrollId: !!newScrollId,
              firstTraceId: traces[0]?.trace_id,
              firstTraceTimestamp: traces[0]?.timestamps.started_at,
              lastTraceId: traces[traces.length - 1]?.trace_id,
              lastTraceTimestamp:
                traces[traces.length - 1]?.timestamps.started_at,
            },
            "Returning traces result",
          );

          // Enrich with evaluations — direct ClickHouse query, no extra isClickHouseEnabled roundtrip
          const traceIds = groups.flat().map((t) => t.trace_id);
          let traceChecks: TracesForProjectResult["traceChecks"] = {};
          if (traceIds.length > 0 && clickHouseClient) {
            const evalRows = await this.fetchEvaluationRows({
              clickHouseClient,
              projectId: input.projectId,
              traceIds,
            });

            const grouped: Record<
              string,
              ReturnType<typeof mapClickHouseEvaluationToTraceEvaluation>[]
            > = {};
            for (const id of traceIds) {
              grouped[id] = [];
            }
            for (const row of evalRows) {
              if (row.TraceId && grouped[row.TraceId]) {
                grouped[row.TraceId]!.push(
                  mapClickHouseEvaluationToTraceEvaluation(row),
                );
              }
            }

            traceChecks = mapTraceEvaluationsToLegacyEvaluations(grouped);
          }

          return {
            groups,
            totalHits,
            traceChecks,
            scrollId: newScrollId,
          };
        } catch (error) {
          this.logger.error(
            {
              projectId: input.projectId,
              error: error instanceof Error ? error.message : error,
              stack: error instanceof Error ? error.stack : undefined,
            },
            "Failed to fetch all traces from ClickHouse",
          );
          throw error;
        }
      },
    );
  }

  /**
   * Get topic and subtopic counts for a project.
   *
   * Returns null if ClickHouse is not enabled for the project.
   *
   * @param input - Filter parameters including projectId and date range
   * @returns TopicCountsResult or null if ClickHouse is not enabled
   */
  async getTopicCounts(
    input: AggregationFiltersInput,
  ): Promise<TopicCountsResult | null> {
    return await this.tracer.withActiveSpan(
      "ClickHouseTraceService.getTopicCounts",
      { attributes: { "tenant.id": input.projectId } },
      async () => {
        const clickHouseClient = await this.resolveClient(input.projectId);
        if (!clickHouseClient) {
          return null;
        }

        try {
          // Build date filter conditions
          const conditions: string[] = ["TenantId = {tenantId:String}"];
          if (input.startDate) {
            conditions.push(
              "CreatedAt >= fromUnixTimestamp64Milli({startDate:UInt64})",
            );
          }
          if (input.endDate) {
            conditions.push(
              "CreatedAt <= fromUnixTimestamp64Milli({endDate:UInt64})",
            );
          }

          const whereClause = conditions.join(" AND ");

          const result = await clickHouseClient.query({
            query: `
              SELECT
                TopicId,
                SubTopicId,
                count() as count
              FROM trace_summaries
              WHERE ${whereClause}
                AND (TopicId IS NOT NULL OR SubTopicId IS NOT NULL)
              GROUP BY TopicId, SubTopicId
              LIMIT 10000
            `,
            query_params: {
              tenantId: input.projectId,
              startDate: input.startDate ?? 0,
              endDate: input.endDate ?? Date.now(),
            },
            format: "JSONEachRow",
          });

          const rows = (await result.json()) as Array<{
            TopicId: string | null;
            SubTopicId: string | null;
            count: string;
          }>;

          // Aggregate counts by topic and subtopic
          const topicCountsMap = new Map<string, number>();
          const subtopicCountsMap = new Map<string, number>();

          for (const row of rows) {
            if (row.TopicId) {
              const current = topicCountsMap.get(row.TopicId) ?? 0;
              topicCountsMap.set(
                row.TopicId,
                current + parseInt(row.count, 10),
              );
            }
            if (row.SubTopicId) {
              const current = subtopicCountsMap.get(row.SubTopicId) ?? 0;
              subtopicCountsMap.set(
                row.SubTopicId,
                current + parseInt(row.count, 10),
              );
            }
          }

          return {
            topicCounts: Array.from(topicCountsMap.entries()).map(
              ([key, count]) => ({ key, count }),
            ),
            subtopicCounts: Array.from(subtopicCountsMap.entries()).map(
              ([key, count]) => ({ key, count }),
            ),
          };
        } catch (error) {
          this.logger.error(
            {
              projectId: input.projectId,
              error: error instanceof Error ? error.message : error,
            },
            "Failed to fetch topic counts from ClickHouse",
          );
          throw new Error("Failed to fetch topic counts");
        }
      },
    );
  }

  /**
   * Get unique customers and labels for a project.
   *
   * Returns null if ClickHouse is not enabled for the project.
   *
   * @param input - Filter parameters including projectId and date range
   * @returns CustomersAndLabelsResult or null if ClickHouse is not enabled
   */
  async getCustomersAndLabels(
    input: AggregationFiltersInput,
  ): Promise<CustomersAndLabelsResult | null> {
    return await this.tracer.withActiveSpan(
      "ClickHouseTraceService.getCustomersAndLabels",
      { attributes: { "tenant.id": input.projectId } },
      async () => {
        const clickHouseClient = await this.resolveClient(input.projectId);
        if (!clickHouseClient) {
          return null;
        }

        try {
          // Build date filter conditions
          const conditions: string[] = ["TenantId = {tenantId:String}"];
          if (input.startDate) {
            conditions.push(
              "CreatedAt >= fromUnixTimestamp64Milli({startDate:UInt64})",
            );
          }
          if (input.endDate) {
            conditions.push(
              "CreatedAt <= fromUnixTimestamp64Milli({endDate:UInt64})",
            );
          }

          const whereClause = conditions.join(" AND ");

          // Query for unique customer IDs
          const customerResult = await clickHouseClient.query({
            query: `
              SELECT DISTINCT Attributes['langwatch.customer_id'] as customer_id
              FROM trace_summaries
              WHERE ${whereClause}
                AND Attributes['langwatch.customer_id'] != ''
              LIMIT 10000
            `,
            query_params: {
              tenantId: input.projectId,
              startDate: input.startDate ?? 0,
              endDate: input.endDate ?? Date.now(),
            },
            format: "JSONEachRow",
          });

          const customerRows = (await customerResult.json()) as Array<{
            customer_id: string;
          }>;

          // Query for unique labels
          // Labels are stored as JSON array in langwatch.labels attribute
          const labelsResult = await clickHouseClient.query({
            query: `
              SELECT DISTINCT Attributes['langwatch.labels'] as labels_json
              FROM trace_summaries
              WHERE ${whereClause}
                AND Attributes['langwatch.labels'] != ''
              LIMIT 10000
            `,
            query_params: {
              tenantId: input.projectId,
              startDate: input.startDate ?? 0,
              endDate: input.endDate ?? Date.now(),
            },
            format: "JSONEachRow",
          });

          const labelsRows = (await labelsResult.json()) as Array<{
            labels_json: string;
          }>;

          // Parse labels from JSON arrays
          const labelsSet = new Set<string>();
          for (const row of labelsRows) {
            try {
              const labels = JSON.parse(row.labels_json);
              if (Array.isArray(labels)) {
                for (const label of labels) {
                  if (typeof label === "string") {
                    labelsSet.add(label);
                  }
                }
              }
            } catch {
              // If not valid JSON, treat as single label
              labelsSet.add(row.labels_json);
            }
          }

          return {
            customers: customerRows.map((r) => r.customer_id),
            labels: Array.from(labelsSet),
          };
        } catch (error) {
          this.logger.error(
            {
              projectId: input.projectId,
              error: error instanceof Error ? error.message : error,
            },
            "Failed to fetch customers and labels from ClickHouse",
          );
          throw new Error("Failed to fetch customers and labels");
        }
      },
    );
  }

  /**
   * Get a span for prompt studio by span ID.
   *
   * Returns null if:
   * - ClickHouse is not enabled for the project
   * - The span is not found
   * - The span is not an LLM span
   *
   * @param projectId - The project ID
   * @param spanId - The span ID to find
   * @param protections - Field redaction protections
   * @returns PromptStudioSpanResult or null
   */
  async getSpanForPromptStudio(
    projectId: string,
    spanId: string,
    protections: Protections,
  ): Promise<PromptStudioSpanResult | null> {
    return await this.tracer.withActiveSpan(
      "ClickHouseTraceService.getSpanForPromptStudio",
      { attributes: { "tenant.id": projectId, "span.id": spanId } },
      async () => {
        const clickHouseClient = await this.resolveClient(projectId);
        if (!clickHouseClient) {
          return null;
        }

        try {
          // Fetch ALL spans in the trace in a single query so we can
          // both extract LLM data and walk ancestors for prompt reference.
          const queryResult = await clickHouseClient.query({
            query: `
              SELECT
                SpanId,
                TraceId,
                ParentSpanId,
                SpanName,
                SpanAttributes,
                toUnixTimestamp64Milli(StartTime) AS StartTime,
                toUnixTimestamp64Milli(EndTime) AS EndTime,
                DurationMs,
                StatusCode,
                StatusMessage
              FROM stored_spans
              WHERE TenantId = {tenantId:String}
                AND TraceId = (
                  SELECT TraceId FROM stored_spans
                  WHERE TenantId = {tenantId:String}
                    AND SpanId = {spanId:String}
                  LIMIT 1
                )
              LIMIT 1000
            `,
            query_params: {
              tenantId: projectId,
              spanId,
            },
            format: "JSONEachRow",
          });

          const allRows = (await queryResult.json()) as Array<{
            SpanId: string;
            TraceId: string;
            ParentSpanId: string | null;
            SpanName: string;
            SpanAttributes: Record<string, unknown>;
            StartTime: number;
            EndTime: number;
            DurationMs: number;
            StatusCode: number | null;
            StatusMessage: string | null;
          }>;

          const requestedRow = allRows.find((r) => r.SpanId === spanId);
          if (!requestedRow) {
            return null;
          }

          // If the caller pointed us at a non-llm span (e.g. the user
          // clicked "Open in Playground" from the Prompt.compile or
          // PromptApiService.get span, or from the Prompts tab usage
          // card), resolve to the nearest llm in the trace that the
          // operator most likely meant: a descendant first, then a
          // sibling that started at or after the requested span. The
          // playground form needs an llm span's messages + llm config —
          // anything else lands as "No prompts open".
          const requestedType = requestedRow.SpanAttributes[
            "langwatch.span.type"
          ] as string | undefined;
          const row =
            requestedType === "llm"
              ? requestedRow
              : (findNearestLlm(allRows, requestedRow) ?? null);
          if (!row) {
            return null;
          }

          // Extract span data from attributes
          const result = this.extractPromptStudioDataFromClickHouse(
            row,
            protections,
          );

          // If the LLM span itself doesn't have a prompt reference,
          // search ancestors and their siblings to find it (SDK sets it on
          // sibling spans like Prompt.compile or PromptApiService.get)
          if (!result.promptHandle) {
            const ancestorSpans = allRows.map((r) => {
              const attributes: Record<string, unknown> = {};
              const promptId = r.SpanAttributes["langwatch.prompt.id"];
              if (promptId) attributes["langwatch.prompt.id"] = promptId;
              const promptVars = r.SpanAttributes["langwatch.prompt.variables"];
              if (promptVars)
                attributes["langwatch.prompt.variables"] = promptVars;
              const promptHandle = r.SpanAttributes["langwatch.prompt.handle"];
              if (promptHandle)
                attributes["langwatch.prompt.handle"] = promptHandle;
              const promptVersion =
                r.SpanAttributes["langwatch.prompt.version.number"];
              if (promptVersion)
                attributes["langwatch.prompt.version.number"] = promptVersion;
              return {
                spanId: r.SpanId,
                parentSpanId: r.ParentSpanId ?? null,
                startTime: r.StartTime,
                attributes,
              };
            });

            const ancestorRef = findPromptReferenceInAncestors({
              targetSpanId: row.SpanId,
              spans: ancestorSpans,
            });
            if (ancestorRef?.promptHandle) {
              result.promptHandle = ancestorRef.promptHandle;
              result.promptVersionNumber = ancestorRef.promptVersionNumber;
              result.promptTag = ancestorRef.promptTag;
              result.promptVariables = ancestorRef.promptVariables;
            }
          }

          return result;
        } catch (error) {
          this.logger.error(
            {
              projectId,
              spanId,
              error: error instanceof Error ? error.message : error,
            },
            "Failed to fetch span for prompt studio from ClickHouse",
          );
          throw new Error("Failed to fetch span for prompt studio");
        }
      },
    );
  }

  /**
   * Extract prompt studio data from ClickHouse span row.
   * @internal
   */
  private extractPromptStudioDataFromClickHouse(
    row: {
      SpanId: string;
      TraceId: string;
      SpanName: string;
      SpanAttributes: Record<string, unknown>;
      StartTime: number;
      EndTime: number;
      DurationMs: number;
      StatusCode: number | null;
      StatusMessage: string | null;
    },
    _protections: Protections,
  ): PromptStudioSpanResult {
    const attrs = row.SpanAttributes;
    // Pure extraction of input + output messages from the span's
    // attributes. Lives in parseLLMSpanMessages.ts so the wire-shape
    // contract — including the single-message-object form nlpgo emits
    // for langwatch.output — is unit-testable without standing up the
    // full service. See that file's docstring for the shape catalog.
    const messages: PromptStudioSpanResult["messages"] =
      parseLLMSpanMessages(attrs);

    // Extract LLM config
    const model =
      (attrs["gen_ai.response.model"] as string) ??
      (attrs["gen_ai.request.model"] as string) ??
      (attrs["llm.model"] as string) ??
      null;
    const vendor = (attrs["gen_ai.system"] as string) ?? null;

    // Build llmConfig dynamically from the parameter map
    const llmConfig: PromptStudioSpanResult["llmConfig"] = {
      model,
      systemPrompt: messages.find((m) => m.role === "system")?.content,
      temperature: null,
      maxTokens: null,
      topP: null,
      frequencyPenalty: null,
      presencePenalty: null,
      seed: null,
      topK: null,
      minP: null,
      repetitionPenalty: null,
      reasoning: null,
      verbosity: null,
      litellmParams: {},
    };

    for (const param of LLM_PARAMETER_MAP) {
      if (param.otelAttr === null) continue;
      const raw = attrs[param.otelAttr];
      if (raw != null) {
        (llmConfig as Record<string, unknown>)[param.formField] = raw;
      }
    }

    // Extract metrics
    const promptTokens = attrs["gen_ai.usage.prompt_tokens"] as
      | number
      | undefined;
    const completionTokens = attrs["gen_ai.usage.completion_tokens"] as
      | number
      | undefined;

    // Build error if present
    let error: Span["error"] | null = null;
    if (row.StatusCode === 2) {
      error = {
        has_error: true,
        message: row.StatusMessage ?? "Unknown error",
        stacktrace: [],
      };
    }

    // Extract prompt reference from attributes
    const promptRef = parsePromptReference(attrs);

    return {
      spanId: row.SpanId,
      traceId: row.TraceId,
      spanName: row.SpanName ?? null,
      messages,
      llmConfig,
      vendor,
      error,
      timestamps: {
        started_at: row.StartTime,
        finished_at: row.EndTime,
      },
      metrics:
        promptTokens !== undefined || completionTokens !== undefined
          ? {
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
            }
          : null,
      promptHandle: promptRef.promptHandle,
      promptVersionNumber: promptRef.promptVersionNumber,
      promptTag: promptRef.promptTag,
      promptVariables: promptRef.promptVariables,
    };
  }

  /**
   * Get distinct span names and metadata keys for a project.
   *
   * Returns null if ClickHouse is not enabled for the project.
   */
  async getDistinctFieldNames(
    projectId: string,
    startDate: number,
    endDate: number,
  ): Promise<DistinctFieldNamesResult | null> {
    return await this.tracer.withActiveSpan(
      "ClickHouseTraceService.getDistinctFieldNames",
      { attributes: { "tenant.id": projectId } },
      async () => {
        const clickHouseClient = await this.resolveClient(projectId);
        if (!clickHouseClient) {
          return null;
        }

        try {
          // Get distinct span names from stored_spans
          const spanResult = await clickHouseClient.query({
            query: `
              SELECT DISTINCT SpanName
              FROM stored_spans
              WHERE TenantId = {tenantId:String}
                AND StartTime >= fromUnixTimestamp64Milli({startDate:UInt64})
                AND StartTime <= fromUnixTimestamp64Milli({endDate:UInt64})
                AND SpanName != ''
              ORDER BY SpanName ASC
              LIMIT 1000
            `,
            query_params: {
              tenantId: projectId,
              startDate,
              endDate,
            },
            format: "JSONEachRow",
          });

          const spanRows = (await spanResult.json()) as Array<{
            SpanName: string;
          }>;

          const spanNames = spanRows.map((row) => ({
            key: row.SpanName,
            label: row.SpanName,
          }));

          // Get distinct metadata keys from trace_summaries Attributes
          const metaResult = await clickHouseClient.query({
            query: `
              SELECT DISTINCT arrayJoin(mapKeys(Attributes)) AS key
              FROM trace_summaries
              WHERE TenantId = {tenantId:String}
                AND CreatedAt >= fromUnixTimestamp64Milli({startDate:UInt64})
                AND CreatedAt <= fromUnixTimestamp64Milli({endDate:UInt64})
              ORDER BY key ASC
              LIMIT 1000
            `,
            query_params: {
              tenantId: projectId,
              startDate,
              endDate,
            },
            format: "JSONEachRow",
          });

          const metaRows = (await metaResult.json()) as Array<{
            key: string;
          }>;

          const metadataKeys = metaRows.map((row) => ({
            key: row.key,
            label: row.key,
          }));

          return { spanNames, metadataKeys };
        } catch (error) {
          this.logger.error(
            {
              projectId,
              error: error instanceof Error ? error.message : error,
            },
            "Failed to fetch distinct field names from ClickHouse",
          );
          throw new Error("Failed to fetch distinct field names");
        }
      },
    );
  }

  /**
   * Fetch traces with keyset pagination.
   * @internal
   */
  private async fetchTracesWithPagination({
    projectId,
    pageSize,
    sortDirection,
    cursor,
    protections,
    startDate,
    endDate,
    filterConditions,
    filterParams,
    traceIds,
    query,
  }: {
    projectId: string;
    pageSize: number;
    sortDirection: "asc" | "desc";
    cursor: ClickHouseScrollCursor | null;
    protections: Protections;
    startDate?: number;
    endDate?: number;
    filterConditions?: string[];
    filterParams?: Record<string, unknown>;
    traceIds?: string[];
    query?: string;
  }): Promise<{ traces: Trace[]; totalHits: number; lastTrace: Trace | null }> {
    return await this.tracer.withActiveSpan(
      "ClickHouseTraceService.fetchTracesWithPagination",
      {
        attributes: { "tenant.id": projectId },
      },
      async (_span) => {
        const clickHouseClient = await this.resolveClient(projectId);
        if (!clickHouseClient) {
          throw new Error("ClickHouse client not available");
        }

        // Additional filter conditions (already parameterized by the filter module)
        const extraFilters =
          filterConditions && filterConditions.length > 0
            ? " AND " + filterConditions.join(" AND ")
            : "";

        // Explicit trace ID filter — when callers provide specific trace IDs
        const traceIdFilter =
          traceIds && traceIds.length > 0
            ? " AND ts.TraceId IN ({traceIds:Array(String)})"
            : "";

        // Text search on computed I/O — lower(ifNull(...)) matches the ngrambf_v1 indexed expression
        const effectiveQuery = query && query.length >= 3 ? query : undefined;

        // If the user can't see input/output, searching their content is not allowed
        if (
          effectiveQuery &&
          protections.canSeeCapturedInput === false &&
          protections.canSeeCapturedOutput === false
        ) {
          return { traces: [], totalHits: 0, lastTrace: null };
        }

        const searchableColumns = [
          ...(protections.canSeeCapturedInput !== false
            ? ["lower(ifNull(ts.ComputedInput, ''))"]
            : []),
          ...(protections.canSeeCapturedOutput !== false
            ? ["lower(ifNull(ts.ComputedOutput, ''))"]
            : []),
        ];

        const searchFilter = effectiveQuery
          ? ` AND (${searchableColumns.map((col) => `${col} LIKE {searchQuery:String}`).join(" OR ")})`
          : "";

        // Keyset cursor condition — inside WHERE for partition pruning
        let cursorCondition = "";
        if (cursor) {
          cursorCondition =
            sortDirection === "desc"
              ? " AND (toUnixTimestamp64Milli(ts.OccurredAt), ts.TraceId) < ({lastTimestamp:UInt64}, {lastTraceId:String})"
              : " AND (toUnixTimestamp64Milli(ts.OccurredAt), ts.TraceId) > ({lastTimestamp:UInt64}, {lastTraceId:String})";
        }

        const orderDirection = sortDirection === "desc" ? "DESC" : "ASC";

        const sharedParams = {
          tenantId: projectId,
          startDate: startDate ?? 0,
          endDate: endDate ?? Date.now(),
          ...filterParams,
          ...(traceIds && traceIds.length > 0 ? { traceIds } : {}),
          ...(effectiveQuery
            ? {
                searchQuery: `%${effectiveQuery.replace(/[%_\\]/g, "\\$&").toLowerCase()}%`,
              }
            : {}),
        };

        const cursorParams = {
          lastTimestamp: cursor?.lastTimestamp ?? 0,
          lastTraceId: cursor?.lastTraceId ?? "",
        };

        // Step 1: Find page trace IDs + count in parallel.
        // The ID query is lightweight (no heavy columns), and the count uses
        // HyperLogLog (~2% error) which is fine for pagination display.
        const [countResult, idsResult] = await Promise.all([
          clickHouseClient.query({
            query: `
              SELECT uniq(ts.TraceId) as total
              FROM trace_summaries ts
              WHERE ts.TenantId = {tenantId:String}
                AND ts.OccurredAt >= fromUnixTimestamp64Milli({startDate:UInt64})
                AND ts.OccurredAt <= fromUnixTimestamp64Milli({endDate:UInt64})
                ${extraFilters}
                ${traceIdFilter}
                ${searchFilter}
            `,
            query_params: sharedParams,
            format: "JSONEachRow",
          }),
          clickHouseClient.query({
            query: `
              SELECT s.TraceId
              FROM (
                SELECT ts.TraceId AS TraceId,
                       argMax(ts.OccurredAt, ts.UpdatedAt) AS _oa
                FROM trace_summaries ts
                WHERE ts.TenantId = {tenantId:String}
                  AND ts.OccurredAt >= fromUnixTimestamp64Milli({startDate:UInt64})
                  AND ts.OccurredAt <= fromUnixTimestamp64Milli({endDate:UInt64})
                  ${extraFilters}
                  ${traceIdFilter}
                  ${searchFilter}
                  ${cursorCondition}
                GROUP BY ts.TraceId
              ) s
              ORDER BY s._oa ${orderDirection}, s.TraceId ${orderDirection}
              LIMIT {pageSize:UInt32}
            `,
            query_params: {
              ...sharedParams,
              ...cursorParams,
              pageSize,
            },
            format: "JSONEachRow",
          }),
        ]);

        const [countRows, idRows] = await Promise.all([
          countResult.json() as Promise<Array<{ total: string }>>,
          idsResult.json() as Promise<Array<{ TraceId: string }>>,
        ]);

        const totalHits = parseInt(countRows[0]?.total ?? "0", 10);
        const pageTraceIds = idRows.map((r) => r.TraceId);

        if (pageTraceIds.length === 0) {
          return { traces: [], totalHits, lastTrace: null };
        }

        // Step 2: Fetch full data for just the page's trace IDs.
        // The dedup subquery is scoped to pageTraceIds so it only reads
        // N traces instead of the entire table.
        const summaryRows = await this.fetchTraceSummaryRows({
          clickHouseClient,
          projectId,
          startDate: startDate ?? 0,
          endDate: endDate ?? Date.now(),
          traceIds: pageTraceIds,
          orderDirection,
        });

        const traces: Trace[] = summaryRows.map((row) => {
          const summary = this.rowToTraceSummaryData(row);
          const trace = mapTraceSummaryToTrace(summary, [], projectId);
          return applyTraceProtections(trace, protections);
        });

        const lastTrace =
          traces.length > 0 ? (traces[traces.length - 1] ?? null) : null;

        return { traces, totalHits, lastTrace };
      },
    );
  }

  private static readonly SUMMARY_BATCH_SIZE = 25;

  /**
   * Fetch full trace summary rows for a set of trace IDs.
   * On ClickHouse MEMORY_LIMIT_EXCEEDED, retries in smaller batches
   * so that heavy ComputedInput/ComputedOutput columns don't blow the
   * per-query memory cap. If a single batch still OOMs the error propagates.
   */
  private async fetchTraceSummaryRows({
    clickHouseClient,
    projectId,
    startDate,
    endDate,
    traceIds,
    orderDirection,
  }: {
    clickHouseClient: ClickHouseClient;
    projectId: string;
    startDate: number;
    endDate: number;
    traceIds: string[];
    orderDirection: string;
  }): Promise<TraceSummaryRow[]> {
    const runQuery = async (ids: string[]) => {
      const result = await clickHouseClient.query({
        query: `
          SELECT
            ts.TraceId AS ts_TraceId,
            ts.SpanCount AS ts_SpanCount,
            ts.TotalDurationMs AS ts_TotalDurationMs,
            ts.ComputedIOSchemaVersion AS ts_ComputedIOSchemaVersion,
            ts.TimeToFirstTokenMs AS ts_TimeToFirstTokenMs,
            ts.TimeToLastTokenMs AS ts_TimeToLastTokenMs,
            ts.TokensPerSecond AS ts_TokensPerSecond,
            ts.ContainsErrorStatus AS ts_ContainsErrorStatus,
            ts.ContainsOKStatus AS ts_ContainsOKStatus,
            ts.ErrorMessage AS ts_ErrorMessage,
            ts.Models AS ts_Models,
            ts.TotalCost AS ts_TotalCost,
            ts.TokensEstimated AS ts_TokensEstimated,
            ts.TotalPromptTokenCount AS ts_TotalPromptTokenCount,
            ts.TotalCompletionTokenCount AS ts_TotalCompletionTokenCount,
            ts.TopicId AS ts_TopicId,
            ts.SubTopicId AS ts_SubTopicId,
            ts.HasAnnotation AS ts_HasAnnotation,
            ts.AnnotationIds AS ts_AnnotationIds,
            ts.ComputedInput AS ts_ComputedInput,
            ts.ComputedOutput AS ts_ComputedOutput,
            ts.Attributes AS ts_Attributes,
            ts.TraceName AS ts_TraceName,
            toUnixTimestamp64Milli(ts.OccurredAt) AS ts_OccurredAt,
            toUnixTimestamp64Milli(ts.CreatedAt) AS ts_CreatedAt,
            toUnixTimestamp64Milli(ts.UpdatedAt) AS ts_UpdatedAt
          FROM trace_summaries ts
          WHERE ts.TenantId = {tenantId:String}
            AND ts.OccurredAt >= fromUnixTimestamp64Milli({startDate:UInt64})
            AND ts.OccurredAt <= fromUnixTimestamp64Milli({endDate:UInt64})
            AND ts.TraceId IN ({pageTraceIds:Array(String)})
            AND (ts.TenantId, ts.TraceId, ts.UpdatedAt) IN (
              SELECT TenantId, TraceId, max(UpdatedAt)
              FROM trace_summaries
              WHERE TenantId = {tenantId:String}
                AND OccurredAt >= fromUnixTimestamp64Milli({startDate:UInt64})
                AND OccurredAt <= fromUnixTimestamp64Milli({endDate:UInt64})
                AND TraceId IN ({pageTraceIds:Array(String)})
              GROUP BY TenantId, TraceId
            )
          ORDER BY ts.OccurredAt ${orderDirection}, ts.TraceId ${orderDirection}
        `,
        query_params: {
          tenantId: projectId,
          startDate,
          endDate,
          pageTraceIds: ids,
        },
        format: "JSONEachRow",
      });
      return result.json() as Promise<TraceSummaryRow[]>;
    };

    try {
      return await runQuery(traceIds);
    } catch (error) {
      if (!isClickHouseMemoryLimitError(error)) {
        throw error;
      }

      this.logger.warn(
        `Summary query OOM for ${traceIds.length} traces, retrying in batches of ${ClickHouseTraceService.SUMMARY_BATCH_SIZE}`,
      );

      const allRows: TraceSummaryRow[] = [];
      for (
        let i = 0;
        i < traceIds.length;
        i += ClickHouseTraceService.SUMMARY_BATCH_SIZE
      ) {
        const batch = traceIds.slice(
          i,
          i + ClickHouseTraceService.SUMMARY_BATCH_SIZE,
        );
        const batchRows = await runQuery(batch);
        allRows.push(...batchRows);
      }

      const dir = orderDirection === "DESC" ? -1 : 1;
      allRows.sort((a, b) => {
        const timeDiff = a.ts_OccurredAt - b.ts_OccurredAt;
        if (timeDiff !== 0) return timeDiff * dir;
        if (a.ts_TraceId === b.ts_TraceId) return 0;
        return a.ts_TraceId < b.ts_TraceId ? -dir : dir;
      });

      return allRows;
    }
  }

  /**
   * Fetch evaluation rows for a set of trace IDs.
   * Same OOM-resilient pattern as fetchTraceSummaryRows.
   */
  private async fetchEvaluationRows({
    clickHouseClient,
    projectId,
    traceIds,
  }: {
    clickHouseClient: ClickHouseClient;
    projectId: string;
    traceIds: string[];
  }): Promise<ClickHouseEvaluationRunRow[]> {
    const runQuery = async (ids: string[]) => {
      const result = await clickHouseClient.query({
        query: `
          SELECT *
          FROM evaluation_runs
          WHERE TenantId = {tenantId:String}
            AND TraceId IN ({traceIds:Array(String)})
            AND (TenantId, EvaluationId, UpdatedAt) IN (
              SELECT TenantId, EvaluationId, max(UpdatedAt)
              FROM evaluation_runs
              WHERE TenantId = {tenantId:String}
                AND TraceId IN ({traceIds:Array(String)})
              GROUP BY TenantId, EvaluationId
            )
        `,
        query_params: {
          tenantId: projectId,
          traceIds: ids,
        },
        format: "JSONEachRow",
      });
      return result.json() as Promise<ClickHouseEvaluationRunRow[]>;
    };

    try {
      return await runQuery(traceIds);
    } catch (error) {
      if (!isClickHouseMemoryLimitError(error)) {
        throw error;
      }

      this.logger.warn(
        `Evaluations query OOM for ${traceIds.length} traces, retrying in batches of ${ClickHouseTraceService.SUMMARY_BATCH_SIZE}`,
      );

      const allRows: ClickHouseEvaluationRunRow[] = [];
      for (
        let i = 0;
        i < traceIds.length;
        i += ClickHouseTraceService.SUMMARY_BATCH_SIZE
      ) {
        const batch = traceIds.slice(
          i,
          i + ClickHouseTraceService.SUMMARY_BATCH_SIZE,
        );
        const batchRows = await runQuery(batch);
        allRows.push(...batchRows);
      }

      return allRows;
    }
  }

  /**
   * Convert a summary row to TraceSummaryData.
   * @internal
   */
  private rowToTraceSummaryData(row: TraceSummaryRow): TraceSummaryData {
    return {
      traceId: row.ts_TraceId,
      spanCount: row.ts_SpanCount,
      totalDurationMs: row.ts_TotalDurationMs,
      computedIOSchemaVersion: row.ts_ComputedIOSchemaVersion,
      computedInput: row.ts_ComputedInput ?? null,
      computedOutput: row.ts_ComputedOutput ?? null,
      timeToFirstTokenMs: row.ts_TimeToFirstTokenMs,
      timeToLastTokenMs: row.ts_TimeToLastTokenMs,
      tokensPerSecond: row.ts_TokensPerSecond,
      containsErrorStatus: row.ts_ContainsErrorStatus,
      containsOKStatus: row.ts_ContainsOKStatus,
      errorMessage: row.ts_ErrorMessage,
      models: row.ts_Models,
      totalCost: row.ts_TotalCost,
      tokensEstimated: row.ts_TokensEstimated,
      totalPromptTokenCount: row.ts_TotalPromptTokenCount,
      totalCompletionTokenCount: row.ts_TotalCompletionTokenCount,
      outputFromRootSpan: row.ts_OutputFromRootSpan ?? false,
      outputSpanEndTimeMs: row.ts_OutputSpanEndTimeMs ?? 0,
      blockedByGuardrail: false,
      rootSpanType: null,
      containsAi: false,
      containsPrompt: false,
      selectedPromptId: null,
      selectedPromptSpanId: null,
      selectedPromptStartTimeMs: null,
      lastUsedPromptId: null,
      lastUsedPromptVersionNumber: null,
      lastUsedPromptVersionId: null,
      lastUsedPromptSpanId: null,
      lastUsedPromptStartTimeMs: null,
      topicId: row.ts_TopicId,
      subTopicId: row.ts_SubTopicId,
      annotationIds: row.ts_AnnotationIds ?? [],
      traceName: row.ts_TraceName ?? "",
      attributes: row.ts_Attributes,
      LastEventOccurredAt: 0,
      occurredAt: row.ts_OccurredAt,
      createdAt: row.ts_CreatedAt,
      updatedAt: row.ts_UpdatedAt,
    };
  }

  /**
   * Group traces by the specified field.
   * @internal
   */
  private groupTraces(traces: Trace[], groupBy?: string): Trace[][] {
    if (!groupBy || groupBy === "none") {
      return traces.map((trace) => [trace]);
    }

    const groups: Map<string, Trace[]> = new Map();

    for (const trace of traces) {
      let key: string | null = null;

      if (groupBy === "user_id") {
        key = trace.metadata.user_id ?? null;
      } else if (groupBy === "thread_id") {
        key = trace.metadata.thread_id ?? null;
      }

      if (key) {
        const group = groups.get(key) ?? [];
        group.push(trace);
        groups.set(key, group);
      } else {
        // No grouping key - each trace is its own group
        groups.set(trace.trace_id, [trace]);
      }
    }

    return Array.from(groups.values());
  }

  /**
   * Resolve offloaded blob refs (if any), map normalized spans to legacy Span
   * objects, build the Trace via mapTraceSummaryToTrace, patch recomputed I/O,
   * and apply field-redaction protections.
   *
   * Extracted to remove the duplicated resolve+map+merge block that previously
   * appeared in both getTracesWithSpans and enrichTracesWithSpans. Both call
   * sites are now a single line.
   *
   * @internal
   */
  private async resolveAndMerge({
    projectId,
    summary,
    spans,
    protections,
  }: {
    projectId: string;
    summary: TraceSummaryData;
    spans: NormalizedSpan[];
    protections: Protections;
  }): Promise<Trace> {
    let resolvedSpans = spans;
    let recomputedInput: ExtractedIO | null = null;
    let recomputedOutput: ExtractedIO | null = null;

    if (this.resolveTraceSpans) {
      const resolution = await this.resolveTraceSpans(projectId, spans);
      resolvedSpans = resolution.resolvedSpans;
      if (resolution.anyResolved) {
        recomputedInput = resolution.recomputedInput;
        recomputedOutput = resolution.recomputedOutput;
      }
    }

    const mappedSpans = mapNormalizedSpansToSpans(resolvedSpans);
    let trace = mapTraceSummaryToTrace(summary, mappedSpans, projectId);

    // When blobs were resolved, patch trace.input / trace.output with
    // the recomputed full values (overwriting the preview from trace_summaries).
    if (recomputedInput !== null || recomputedOutput !== null) {
      trace = {
        ...trace,
        ...(recomputedInput !== null
          ? { input: { value: recomputedInput.text } }
          : {}),
        ...(recomputedOutput !== null
          ? { output: { value: recomputedOutput.text } }
          : {}),
      };
    }

    return applyTraceProtections(trace, protections);
  }

  /**
   * Enrich traces (which have empty spans) with actual span data from ClickHouse.
   *
   * Fetches spans via fetchTracesWithSpansJoined and replaces the empty span
   * arrays on each trace with the real spans. Traces whose spans are not found
   * are returned unchanged (with empty spans).
   *
   * @internal
   */
  private async enrichTracesWithSpans(
    traces: Trace[],
    projectId: string,
    protections: Protections,
  ): Promise<Trace[]> {
    const traceIds = traces.map((t) => t.trace_id);
    const tracesWithSpans = await this.fetchTracesWithSpansJoined(
      projectId,
      traceIds,
    );

    return Promise.all(
      traces.map(async (trace) => {
        const data = tracesWithSpans.get(trace.trace_id);
        if (!data || data.spans.length === 0) {
          return trace;
        }

        return this.resolveAndMerge({
          projectId,
          summary: data.summary,
          spans: data.spans,
          protections,
        });
      }),
    );
  }

  /**
   * Fetch trace summaries with their spans using a JOIN query.
   * This is more efficient than two separate queries.
   *
   * The query joins trace_summaries with stored_spans on TenantId and TraceId,
   * returning all data needed to construct Trace objects.
   *
   * @internal
   */
  private async fetchTracesWithSpansJoined(
    projectId: string,
    traceIds: string[],
  ): Promise<
    Map<string, { summary: TraceSummaryData; spans: NormalizedSpan[] }>
  > {
    return await this.tracer.withActiveSpan(
      "ClickHouseTraceService.fetchTracesWithSpansJoined",
      {
        attributes: { "tenant.id": projectId },
      },
      async (_span) => {
        const clickHouseClient = await this.resolveClient(projectId);
        if (!clickHouseClient) {
          throw new Error("ClickHouse client not available");
        }

        // Summaries first (light, one row per trace): they carry OccurredAt,
        // which bounds the heavy stored_spans scan below to the traces' weekly
        // partitions instead of cold-scanning every partition on S3. A span's
        // StartTime always falls within its trace's lifetime, so a ±2-day window
        // around the summaries' OccurredAt range is safe headroom; when no
        // summary row is found we fall back to an unbounded span scan.
        const summaryResult = await clickHouseClient.query({
            query: `
        SELECT
          TraceId AS ts_TraceId,
          SpanCount AS ts_SpanCount,
          TotalDurationMs AS ts_TotalDurationMs,
          ComputedIOSchemaVersion AS ts_ComputedIOSchemaVersion,
          ComputedInput AS ts_ComputedInput,
          ComputedOutput AS ts_ComputedOutput,
          TimeToFirstTokenMs AS ts_TimeToFirstTokenMs,
          TimeToLastTokenMs AS ts_TimeToLastTokenMs,
          TokensPerSecond AS ts_TokensPerSecond,
          ContainsErrorStatus AS ts_ContainsErrorStatus,
          ContainsOKStatus AS ts_ContainsOKStatus,
          ErrorMessage AS ts_ErrorMessage,
          Models AS ts_Models,
          TotalCost AS ts_TotalCost,
          TokensEstimated AS ts_TokensEstimated,
          TotalPromptTokenCount AS ts_TotalPromptTokenCount,
          TotalCompletionTokenCount AS ts_TotalCompletionTokenCount,
          TopicId AS ts_TopicId,
          SubTopicId AS ts_SubTopicId,
          HasAnnotation AS ts_HasAnnotation,
          AnnotationIds AS ts_AnnotationIds,
          Attributes AS ts_Attributes,
          TraceName AS ts_TraceName,
          toUnixTimestamp64Milli(OccurredAt) AS ts_OccurredAt,
          toUnixTimestamp64Milli(CreatedAt) AS ts_CreatedAt,
          toUnixTimestamp64Milli(UpdatedAt) AS ts_UpdatedAt
        FROM trace_summaries AS t
        WHERE t.TenantId = {tenantId:String}
          AND t.TraceId IN ({traceIds:Array(String)})
          AND (t.TenantId, t.TraceId, t.UpdatedAt) IN (
            SELECT TenantId, TraceId, max(UpdatedAt)
            FROM trace_summaries
            WHERE TenantId = {tenantId:String}
              AND TraceId IN ({traceIds:Array(String)})
            GROUP BY TenantId, TraceId
          )
        ORDER BY t.TraceId
      `,
            query_params: { tenantId: projectId, traceIds },
            format: "JSONEachRow",
          });

        const summaryRows = (await summaryResult.json()) as TraceSummaryRow[];

        // No matched summaries: the result map is built solely from summary
        // rows, so the spans would be discarded anyway. Return early to skip the
        // (otherwise unbounded) stored_spans scan — the very cold scan this path
        // is meant to avoid.
        if (summaryRows.length === 0) {
          return new Map();
        }

        // Bound the stored_spans scan to the weeks the matched traces occurred
        // in (the cold-scan cost driver).
        const SPAN_PARTITION_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
        const occurredAts = summaryRows
          .map((r) => r.ts_OccurredAt)
          .filter((t): t is number => typeof t === "number" && t > 0);
        const hasWindow = occurredAts.length > 0;
        const spanTimeFilterOuter = hasWindow
          ? "AND t.StartTime >= fromUnixTimestamp64Milli({spanFromMs:Int64}) AND t.StartTime <= fromUnixTimestamp64Milli({spanToMs:Int64})"
          : "";
        const spanTimeFilterInner = hasWindow
          ? "AND StartTime >= fromUnixTimestamp64Milli({spanFromMs:Int64}) AND StartTime <= fromUnixTimestamp64Milli({spanToMs:Int64})"
          : "";
        const spanTimeParams = hasWindow
          ? {
              spanFromMs: Math.min(...occurredAts) - SPAN_PARTITION_WINDOW_MS,
              spanToMs: Math.max(...occurredAts) + SPAN_PARTITION_WINDOW_MS,
            }
          : {};

        const spansResult = await clickHouseClient.query({
            query: `
        SELECT
          SpanId,
          TraceId,
          TenantId,
          ParentSpanId,
          ParentTraceId,
          ParentIsRemote,
          Sampled,
          toUnixTimestamp64Milli(StartTime) AS StartTime,
          toUnixTimestamp64Milli(EndTime) AS EndTime,
          DurationMs,
          SpanName,
          SpanKind,
          ResourceAttributes,
          SpanAttributes,
          StatusCode,
          StatusMessage,
          ScopeName,
          ScopeVersion,
          arrayMap(x -> toUnixTimestamp64Milli(x), \`Events.Timestamp\`) AS Events_Timestamp,
          \`Events.Name\` AS Events_Name,
          \`Events.Attributes\` AS Events_Attributes,
          \`Links.TraceId\` AS Links_TraceId,
          \`Links.SpanId\` AS Links_SpanId,
          \`Links.Attributes\` AS Links_Attributes
        FROM stored_spans AS t
        WHERE t.TenantId = {tenantId:String}
          AND t.TraceId IN ({traceIds:Array(String)})
          ${spanTimeFilterOuter}
          AND (t.TenantId, t.TraceId, t.SpanId, t.StartTime) IN (
            SELECT TenantId, TraceId, SpanId, max(StartTime)
            FROM stored_spans
            WHERE TenantId = {tenantId:String}
              AND TraceId IN ({traceIds:Array(String)})
              ${spanTimeFilterInner}
            GROUP BY TenantId, TraceId, SpanId
          )
        ORDER BY t.TraceId, t.StartTime ASC
        LIMIT 200 BY t.TraceId
      `,
            query_params: { tenantId: projectId, traceIds, ...spanTimeParams },
            format: "JSONEachRow",
          });

        // Parse spans
        type SpanRow = {
          SpanId: string;
          TraceId: string;
          TenantId: string;
          ParentSpanId: string | null;
          ParentTraceId: string | null;
          ParentIsRemote: boolean | null;
          Sampled: boolean;
          StartTime: number;
          EndTime: number;
          DurationMs: number;
          SpanName: string;
          SpanKind: number;
          ResourceAttributes: Record<string, unknown>;
          SpanAttributes: Record<string, unknown>;
          StatusCode: number | null;
          StatusMessage: string | null;
          ScopeName: string | null;
          ScopeVersion: string | null;
          Events_Timestamp: number[];
          Events_Name: string[];
          Events_Attributes: Record<string, unknown>[];
          Links_TraceId: string[];
          Links_SpanId: string[];
          Links_Attributes: Record<string, unknown>[];
        };
        const spanRows = (await spansResult.json()) as SpanRow[];

        // Group spans by TraceId
        const spansByTrace = new Map<string, NormalizedSpan[]>();
        for (const row of spanRows) {
          const spans = spansByTrace.get(row.TraceId) ?? [];
          spans.push(this.mapSpanRow(row, projectId));
          spansByTrace.set(row.TraceId, spans);
        }

        // Build the tracesMap by combining summaries + spans
        const tracesMap = new Map<
          string,
          { summary: TraceSummaryData; spans: NormalizedSpan[] }
        >();

        for (const row of summaryRows) {
          const traceId = row.ts_TraceId;
          const summary = this.rowToTraceSummaryData(row);
          tracesMap.set(traceId, {
            summary,
            spans: spansByTrace.get(traceId) ?? [],
          });
        }

        return tracesMap;
      },
    );
  }

  /**
   * Extract TraceSummaryData from a joined row.
   * @internal
   */
  private extractTraceSummaryFromRow(
    row: JoinedTraceSpanRow,
  ): TraceSummaryData {
    return {
      traceId: row.ts_TraceId,
      spanCount: row.ts_SpanCount,
      totalDurationMs: row.ts_TotalDurationMs,
      computedIOSchemaVersion: row.ts_ComputedIOSchemaVersion,
      computedInput: row.ts_ComputedInput ?? null,
      computedOutput: row.ts_ComputedOutput ?? null,
      timeToFirstTokenMs: row.ts_TimeToFirstTokenMs,
      timeToLastTokenMs: row.ts_TimeToLastTokenMs,
      tokensPerSecond: row.ts_TokensPerSecond,
      containsErrorStatus: row.ts_ContainsErrorStatus,
      containsOKStatus: row.ts_ContainsOKStatus,
      errorMessage: row.ts_ErrorMessage,
      models: row.ts_Models,
      totalCost: row.ts_TotalCost,
      tokensEstimated: row.ts_TokensEstimated,
      totalPromptTokenCount: row.ts_TotalPromptTokenCount,
      totalCompletionTokenCount: row.ts_TotalCompletionTokenCount,
      outputFromRootSpan: row.ts_OutputFromRootSpan ?? false,
      outputSpanEndTimeMs: row.ts_OutputSpanEndTimeMs ?? 0,
      blockedByGuardrail: false,
      rootSpanType: null,
      containsAi: false,
      containsPrompt: false,
      selectedPromptId: null,
      selectedPromptSpanId: null,
      selectedPromptStartTimeMs: null,
      lastUsedPromptId: null,
      lastUsedPromptVersionNumber: null,
      lastUsedPromptVersionId: null,
      lastUsedPromptSpanId: null,
      lastUsedPromptStartTimeMs: null,
      topicId: row.ts_TopicId,
      subTopicId: row.ts_SubTopicId,
      annotationIds: row.ts_AnnotationIds ?? [],
      traceName: row.ts_TraceName ?? "",
      attributes: row.ts_Attributes,
      LastEventOccurredAt: 0,
      occurredAt: row.ts_OccurredAt,
      createdAt: row.ts_CreatedAt,
      updatedAt: row.ts_UpdatedAt,
    };
  }

  /**
   * Extract NormalizedSpan from a joined row.
   * @internal
   */
  private extractSpanFromRow(
    row: JoinedTraceSpanRow,
    tenantId: string,
  ): NormalizedSpan {
    // Reconstruct events array with proper typing
    const events = (row.ss_Events_Timestamp ?? []).map((timestamp, index) => ({
      name: row.ss_Events_Name?.[index] ?? "",
      timeUnixMs: timestamp,
      attributes: (row.ss_Events_Attributes?.[index] ?? {}) as Record<
        string,
        | string
        | number
        | bigint
        | boolean
        | (string | number | bigint | boolean)[]
      >,
    }));

    // Reconstruct links array with proper typing
    const links = (row.ss_Links_TraceId ?? []).map((linkTraceId, index) => ({
      traceId: linkTraceId,
      spanId: row.ss_Links_SpanId?.[index] ?? "",
      attributes: (row.ss_Links_Attributes?.[index] ?? {}) as Record<
        string,
        | string
        | number
        | bigint
        | boolean
        | (string | number | bigint | boolean)[]
      >,
    }));

    // Map numeric status code to enum
    const statusCode =
      row.ss_StatusCode !== null
        ? (row.ss_StatusCode as NormalizedStatusCode)
        : null;

    // Map numeric span kind to enum
    const kind = (row.ss_SpanKind ?? 0) as NormalizedSpanKind;

    return {
      id: row.ss_Id ?? "",
      traceId: row.ss_TraceId ?? "",
      spanId: row.ss_SpanId ?? "",
      tenantId,
      parentSpanId: row.ss_ParentSpanId,
      parentTraceId: row.ss_ParentTraceId,
      parentIsRemote: row.ss_ParentIsRemote,
      sampled: row.ss_Sampled ?? true,
      startTimeUnixMs: row.ss_StartTime ?? 0,
      endTimeUnixMs: row.ss_EndTime ?? 0,
      durationMs: row.ss_DurationMs ?? 0,
      name: row.ss_SpanName ?? "",
      kind,
      resourceAttributes: (row.ss_ResourceAttributes ?? {}) as Record<
        string,
        | string
        | number
        | bigint
        | boolean
        | (string | number | bigint | boolean)[]
      >,
      spanAttributes: (row.ss_SpanAttributes ?? {}) as Record<
        string,
        | string
        | number
        | bigint
        | boolean
        | (string | number | bigint | boolean)[]
      >,
      events,
      links,
      statusMessage: row.ss_StatusMessage,
      statusCode,
      instrumentationScope: {
        name: row.ss_ScopeName ?? "",
        version: row.ss_ScopeVersion,
      },
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    };
  }

  /**
   * Map a span row from a standalone spans query (no JOIN prefix) to NormalizedSpan.
   * @internal
   */
  private mapSpanRow(
    row: {
      SpanId: string;
      TraceId: string;
      TenantId: string;
      ParentSpanId: string | null;
      ParentTraceId: string | null;
      ParentIsRemote: boolean | null;
      Sampled: boolean;
      StartTime: number;
      EndTime: number;
      DurationMs: number;
      SpanName: string;
      SpanKind: number;
      ResourceAttributes: Record<string, unknown>;
      SpanAttributes: Record<string, unknown>;
      StatusCode: number | null;
      StatusMessage: string | null;
      ScopeName: string | null;
      ScopeVersion: string | null;
      Events_Timestamp: number[];
      Events_Name: string[];
      Events_Attributes: Record<string, unknown>[];
      Links_TraceId: string[];
      Links_SpanId: string[];
      Links_Attributes: Record<string, unknown>[];
    },
    tenantId: string,
  ): NormalizedSpan {
    const events = (row.Events_Timestamp ?? []).map((timestamp, index) => ({
      name: row.Events_Name?.[index] ?? "",
      timeUnixMs: timestamp,
      attributes: (row.Events_Attributes?.[index] ?? {}) as Record<
        string,
        | string
        | number
        | bigint
        | boolean
        | (string | number | bigint | boolean)[]
      >,
    }));

    const links = (row.Links_TraceId ?? []).map((linkTraceId, index) => ({
      traceId: linkTraceId,
      spanId: row.Links_SpanId?.[index] ?? "",
      attributes: (row.Links_Attributes?.[index] ?? {}) as Record<
        string,
        | string
        | number
        | bigint
        | boolean
        | (string | number | bigint | boolean)[]
      >,
    }));

    return {
      id: "",
      traceId: row.TraceId,
      spanId: row.SpanId,
      tenantId,
      parentSpanId: row.ParentSpanId,
      parentTraceId: row.ParentTraceId,
      parentIsRemote: row.ParentIsRemote,
      sampled: row.Sampled,
      startTimeUnixMs: row.StartTime,
      endTimeUnixMs: row.EndTime,
      durationMs: row.DurationMs,
      name: row.SpanName,
      kind: row.SpanKind as NormalizedSpanKind,
      resourceAttributes: row.ResourceAttributes as NormalizedSpan["resourceAttributes"],
      spanAttributes: row.SpanAttributes as NormalizedSpan["spanAttributes"],
      statusCode: row.StatusCode as NormalizedStatusCode | null,
      statusMessage: row.StatusMessage,
      instrumentationScope: {
        name: row.ScopeName ?? "",
        version: row.ScopeVersion,
      },
      events,
      links,
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    };
  }
}

/**
 * Type for trace summary rows from the summary-only query.
 */
interface TraceSummaryRow {
  ts_TraceId: string;
  ts_SpanCount: number;
  ts_TotalDurationMs: number;
  ts_ComputedIOSchemaVersion: string;
  ts_ComputedInput?: string | null;
  ts_ComputedOutput?: string | null;
  ts_TimeToFirstTokenMs: number | null;
  ts_TimeToLastTokenMs: number | null;
  ts_TokensPerSecond: number | null;
  ts_ContainsErrorStatus: boolean;
  ts_ContainsOKStatus: boolean;
  ts_ErrorMessage: string | null;
  ts_Models: string[];
  ts_TotalCost: number | null;
  ts_TokensEstimated: boolean;
  ts_TotalPromptTokenCount: number | null;
  ts_TotalCompletionTokenCount: number | null;
  ts_OutputFromRootSpan?: boolean;
  ts_OutputSpanEndTimeMs?: number;
  ts_TopicId: string | null;
  ts_SubTopicId: string | null;
  ts_HasAnnotation: boolean | null;
  ts_AnnotationIds: string[];
  ts_Attributes: Record<string, string>;
  ts_TraceName?: string | null;
  ts_OccurredAt: number;
  ts_CreatedAt: number;
  ts_UpdatedAt: number;
}

/**
 * Type representing a row from the JOIN query between trace_summaries and stored_spans.
 * All fields are prefixed with ts_ (trace summary) or ss_ (stored span).
 */
interface JoinedTraceSpanRow extends TraceSummaryRow {
  // Span fields (nullable due to LEFT JOIN)
  ss_Id: string | null;
  ss_TraceId: string | null;
  ss_SpanId: string | null;
  ss_TenantId: string | null;
  ss_ParentSpanId: string | null;
  ss_ParentTraceId: string | null;
  ss_ParentIsRemote: boolean | null;
  ss_Sampled: boolean | null;
  ss_StartTime: number | null;
  ss_EndTime: number | null;
  ss_DurationMs: number | null;
  ss_SpanName: string | null;
  ss_SpanKind: number | null;
  ss_ResourceAttributes: Record<string, unknown> | null;
  ss_SpanAttributes: Record<string, unknown> | null;
  ss_StatusCode: number | null;
  ss_StatusMessage: string | null;
  ss_ScopeName: string | null;
  ss_ScopeVersion: string | null;
  ss_Events_Timestamp: number[] | null;
  ss_Events_Name: string[] | null;
  ss_Events_Attributes: Record<string, unknown>[] | null;
  ss_Links_TraceId: string[] | null;
  ss_Links_SpanId: string[] | null;
  ss_Links_Attributes: Record<string, unknown>[] | null;
  ss_DroppedAttributesCount: number | null;
  ss_DroppedEventsCount: number | null;
  ss_DroppedLinksCount: number | null;
}

interface PromptStudioCandidateRow {
  SpanId: string;
  ParentSpanId: string | null;
  SpanAttributes: Record<string, unknown>;
  StartTime: number;
}

function isClickHouseMemoryLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("MEMORY_LIMIT_EXCEEDED") ||
    error.message.toLowerCase().includes("memory limit exceeded") ||
    (error as { type?: string }).type === "MEMORY_LIMIT_EXCEEDED"
  );
}

/**
 * Given a non-llm span the operator clicked "Open in Playground" from
 * (typically `Prompt.compile` or `PromptApiService.get`), find the
 * nearest llm in the same trace to load instead. Preference order:
 *   1. Closest descendant llm under the requested span — usually a child
 *      llm call that consumed the just-compiled prompt.
 *   2. Sibling llm under the same parent that started after the
 *      requested span — the next llm call in the chain.
 *   3. First llm in the trace by start time as a last resort.
 * Returns null when the trace genuinely has no llm spans.
 */
function findNearestLlm<T extends PromptStudioCandidateRow>(
  rows: T[],
  requested: T,
): T | null {
  const isLlm = (r: T) =>
    (r.SpanAttributes["langwatch.span.type"] as string | undefined) === "llm";

  const llmRows = rows.filter(isLlm);
  if (llmRows.length === 0) return null;

  // 1. Descendant llm closest to the requested span (smallest depth diff).
  const childrenByParent = new Map<string, T[]>();
  for (const r of rows) {
    if (!r.ParentSpanId) continue;
    const list = childrenByParent.get(r.ParentSpanId);
    if (list) list.push(r);
    else childrenByParent.set(r.ParentSpanId, [r]);
  }
  const visited = new Set<string>();
  const queue: T[] = [requested];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.SpanId)) continue;
    visited.add(current.SpanId);
    const children = childrenByParent.get(current.SpanId) ?? [];
    for (const child of children) {
      if (isLlm(child)) return child;
      queue.push(child);
    }
  }

  // 2. Sibling llm under the same parent (or root-level peer if the
  //    requested span has no parent) that started at/after the requested
  //    span. Earliest qualifying sibling wins, so we land on the *next*
  //    call rather than one further down the chain. Siblings that
  //    started *before* the requested span do NOT count — those belong
  //    to an earlier turn and would open an unrelated playground
  //    context — so the search falls through to step 3 instead.
  const siblingPool =
    requested.ParentSpanId == null
      ? rows.filter((r) => r.ParentSpanId == null)
      : (childrenByParent.get(requested.ParentSpanId) ?? []);
  const siblings = siblingPool
    .filter((s) => s.SpanId !== requested.SpanId && isLlm(s))
    .sort((a, b) => a.StartTime - b.StartTime);
  const nextOrSame = siblings.find((s) => s.StartTime >= requested.StartTime);
  if (nextOrSame) return nextOrSame;

  // 3. Earliest llm in the trace.
  return llmRows.sort((a, b) => a.StartTime - b.StartTime)[0] ?? null;
}

/**
 * Transform traces to include guardrail information
 */
function transformTracesWithGuardrails(
  traces: Trace[],
): TraceWithGuardrail[] {
  return traces.map((trace) => {
    return {
      ...trace,
      lastGuardrail: void 0,
      annotations: void 0,
    };
  });
}
