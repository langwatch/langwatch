import type { ClickHouseClient } from "@clickhouse/client";
import type { PrismaClient } from "@prisma/client";
import { getClickHouseClient } from "~/server/clickhouse/client";
import { prisma as defaultPrisma } from "~/server/db";
import type { Protections } from "~/server/elasticsearch/protections";
import type { NormalizedSpan } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import {
  NormalizedSpanKind,
  NormalizedStatusCode,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import type { Evaluation, Trace } from "~/server/tracer/types";
import type { TraceWithGuardrail } from "~/components/messages/MessageCard";
import { createLogger } from "~/utils/logger";
import { mapNormalizedSpansToSpans, mapTraceSummaryToTrace } from "./mappers";
import { getLangWatchTracer } from "langwatch";

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
 * Input parameters for getAllTracesForProject from ClickHouse.
 * Mirrors the shape expected by the router's getAllForProjectInput.
 */
export interface GetAllTracesForProjectInput {
  projectId: string;
  startDate?: number;
  endDate?: number;
  pageOffset?: number;
  pageSize?: number;
  groupBy?: string;
  sortBy?: string;
  sortDirection?: string;
  scrollId?: string | null;
}

/**
 * Result structure for getAllTracesForProject.
 * Mirrors the shape returned by the existing ES-based implementation.
 */
export interface TracesForProjectResult {
  groups: TraceWithGuardrail[][];
  totalHits: number;
  traceChecks: Record<string, Evaluation[]>;
  scrollId?: string;
}

/**
 * Service for fetching traces from ClickHouse.
 *
 * This service provides a ClickHouse-based alternative to the Elasticsearch
 * trace fetching logic. It:
 * 1. Checks if ClickHouse is enabled for the project (via project.featureClickHouse)
 * 2. Fetches trace summaries and spans using a JOIN query
 * 3. Maps the ClickHouse types to the legacy Trace/Span types
 *
 * Returns null when ClickHouse is not enabled for the project, allowing
 * the caller to fall back to Elasticsearch.
 */
export class ClickHouseTraceService {
  private readonly clickHouseClient: ClickHouseClient | null;
  private readonly logger = createLogger("langwatch:traces:clickhouse-service");
  private readonly tracer = getLangWatchTracer(
    "langwatch.traces.clickhouse-service"
  );

  constructor(private readonly prisma: PrismaClient) {
    this.clickHouseClient = getClickHouseClient();
  }

  /**
   * Static factory method for creating ClickHouseTraceService with default dependencies.
   */
  static create(prisma: PrismaClient = defaultPrisma): ClickHouseTraceService {
    return new ClickHouseTraceService(prisma);
  }

  /**
   * Check if ClickHouse is enabled for the given project.
   */
  async isClickHouseEnabled(projectId: string): Promise<boolean> {
    return await this.tracer.withActiveSpan(
      "ClickHouseTraceService.isClickHouseEnabled",
      {
        attributes: { "tenant.id": projectId },
      },
      async (span) => {
        if (!this.clickHouseClient) {
          return false;
        }

        const project = await this.prisma.project.findUnique({
          where: { id: projectId },
          select: { featureClickHouse: true },
        });

        span.setAttribute(
          "project.feature.clickhouse",
          project?.featureClickHouse === true
        );

        return project?.featureClickHouse === true;
      }
    );
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
   * @param _protections - Field redaction protections (for future use)
   * @returns Array of Trace objects with spans, or null if ClickHouse is not enabled
   */
  async getTracesWithSpans(
    projectId: string,
    traceIds: string[],
    _protections: Protections
  ): Promise<Trace[] | null> {
    return await this.tracer.withActiveSpan(
      "ClickHouseTraceService.isClickHouseEnabled",
      {
        attributes: { "tenant.id": projectId },
      },
      async (span) => {
        // Check if ClickHouse is enabled
        const isEnabled = await this.isClickHouseEnabled(projectId);
        if (!isEnabled || !this.clickHouseClient) {
          return null;
        }

        if (traceIds.length === 0) {
          return [];
        }

        this.logger.debug(
          { projectId, traceIdCount: traceIds.length },
          "Fetching traces with spans from ClickHouse"
        );

        try {
          // Fetch trace summaries with spans using JOIN
          const tracesWithSpans = await this.fetchTracesWithSpansJoined(
            projectId,
            traceIds
          );

          // Map to legacy Trace format
          const traces: Trace[] = [];
          for (const [_traceId, { summary, spans }] of tracesWithSpans) {
            const mappedSpans = mapNormalizedSpansToSpans(spans);
            const trace = mapTraceSummaryToTrace(
              summary,
              mappedSpans,
              projectId
            );
            traces.push(trace);
          }

          // TODO: Apply protections/redaction to the traces

          this.logger.debug(
            { projectId, traceCount: traces.length },
            "Successfully fetched traces from ClickHouse"
          );

          return traces;
        } catch (error) {
          this.logger.error(
            {
              projectId,
              error: error instanceof Error ? error.message : error,
            },
            "Failed to fetch traces from ClickHouse"
          );
          throw error;
        }
      }
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
   * @param _protections - Field redaction protections (for future use)
   * @returns TracesForProjectResult or null if ClickHouse is not enabled
   */
  async getAllTracesForProject(
    input: GetAllTracesForProjectInput,
    _protections: Protections
  ): Promise<TracesForProjectResult | null> {
    return await this.tracer.withActiveSpan(
      "ClickHouseTraceService.getAllTracesForProject",
      async (span) => {
        // Check if ClickHouse is enabled
        const isEnabled = await this.isClickHouseEnabled(input.projectId);
        if (!isEnabled || !this.clickHouseClient) {
          return null;
        }

        this.logger.debug(
          { projectId: input.projectId, scrollId: input.scrollId },
          "Fetching all traces for project from ClickHouse"
        );

        try {
          const pageSize = input.pageSize ?? 25;
          const sortDirection =
            (input.sortDirection as "asc" | "desc") ?? "desc";

          // Parse cursor from scrollId if present
          let cursor: ClickHouseScrollCursor | null = null;
          if (input.scrollId) {
            try {
              cursor = JSON.parse(
                Buffer.from(input.scrollId, "base64").toString("utf-8")
              );
            } catch (e) {
              this.logger.warn(
                { scrollId: input.scrollId },
                "Invalid scrollId, starting from beginning"
              );
            }
          }

          // Build the query with keyset pagination
          const { traces, totalHits, lastTrace } =
            await this.fetchTracesWithPagination(
              input.projectId,
              pageSize,
              sortDirection,
              cursor,
              input.startDate,
              input.endDate
            );

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
              "base64"
            );
          }

          // Group traces (for now, single-trace groups unless groupBy is specified)
          const rawGroups = this.groupTraces(traces, input.groupBy);

          // Extract evaluations (empty for now, ClickHouse doesn't have evaluations)
          const traceChecks: Record<string, Evaluation[]> = {};
          for (const trace of traces) {
            traceChecks[trace.trace_id] = [];
          }

          // Transform traces to include guardrail information
          const groups = rawGroups.map((group) =>
            transformTracesWithGuardrails(group)
          );

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
            },
            "Failed to fetch all traces from ClickHouse"
          );
          throw error;
        }
      }
    );
  }

  /**
   * Fetch traces with keyset pagination.
   * @internal
   */
  private async fetchTracesWithPagination(
    projectId: string,
    pageSize: number,
    sortDirection: "asc" | "desc",
    cursor: ClickHouseScrollCursor | null,
    startDate?: number,
    endDate?: number
  ): Promise<{ traces: Trace[]; totalHits: number; lastTrace: Trace | null }> {
    return await this.tracer.withActiveSpan(
      "ClickHouseTraceService.fetchTracesWithPagination",
      {
        attributes: { "tenant.id": projectId },
      },
      async (span) => {
        if (!this.clickHouseClient) {
          throw new Error("ClickHouse client not available");
        }

        // Build WHERE conditions
        const conditions: string[] = ["ts.TenantId = {tenantId:String}"];

        // Date range filters
        if (startDate) {
          conditions.push(
            "ts.CreatedAt >= fromUnixTimestamp64Milli({startDate:UInt64})"
          );
        }
        if (endDate) {
          conditions.push(
            "ts.CreatedAt <= fromUnixTimestamp64Milli({endDate:UInt64})"
          );
        }

        // Keyset pagination condition
        if (cursor) {
          if (sortDirection === "desc") {
            // For descending order: get records BEFORE the cursor
            conditions.push(
              `(toUnixTimestamp64Milli(ts.CreatedAt), ts.TraceId) < ({lastTimestamp:UInt64}, {lastTraceId:String})`
            );
          } else {
            // For ascending order: get records AFTER the cursor
            conditions.push(
              `(toUnixTimestamp64Milli(ts.CreatedAt), ts.TraceId) > ({lastTimestamp:UInt64}, {lastTraceId:String})`
            );
          }
        }

        const whereClause = conditions.join(" AND ");
        const orderDirection = sortDirection === "desc" ? "DESC" : "ASC";

        // First, get total count (without pagination)
        const countResult = await this.clickHouseClient.query({
          query: `
        SELECT count(DISTINCT ts.TraceId) as total
        FROM trace_summaries ts
        WHERE ${whereClause.replace(/\(toUnixTimestamp64Milli.*\)/, "1=1")}
      `,
          query_params: {
            tenantId: projectId,
            startDate: startDate ?? 0,
            endDate: endDate ?? Date.now(),
          },
          format: "JSONEachRow",
        });

        const countRows = (await countResult.json()) as Array<{
          total: string;
        }>;
        const totalHits = parseInt(countRows[0]?.total ?? "0", 10);

        // Fetch trace summaries with pagination
        const summaryResult = await this.clickHouseClient.query({
          query: `
        SELECT
          ts.TraceId AS ts_TraceId,
          ts.SpanCount AS ts_SpanCount,
          ts.TotalDurationMs AS ts_TotalDurationMs,
          ts.ComputedIOSchemaVersion AS ts_ComputedIOSchemaVersion,
          ts.ComputedInput AS ts_ComputedInput,
          ts.ComputedOutput AS ts_ComputedOutput,
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
          ts.Attributes AS ts_Attributes,
          toUnixTimestamp64Milli(ts.CreatedAt) AS ts_CreatedAt,
          toUnixTimestamp64Milli(ts.LastUpdatedAt) AS ts_LastUpdatedAt
        FROM trace_summaries ts
        WHERE ${whereClause}
        ORDER BY ts.CreatedAt ${orderDirection}, ts.TraceId ${orderDirection}
        LIMIT {pageSize:UInt32}
      `,
          query_params: {
            tenantId: projectId,
            startDate: startDate ?? 0,
            endDate: endDate ?? Date.now(),
            lastTimestamp: cursor?.lastTimestamp ?? 0,
            lastTraceId: cursor?.lastTraceId ?? "",
            pageSize,
          },
          format: "JSONEachRow",
        });

        const summaryRows = (await summaryResult.json()) as TraceSummaryRow[];

        if (summaryRows.length === 0) {
          return { traces: [], totalHits, lastTrace: null };
        }

        // Get trace IDs for span fetching
        const traceIds = summaryRows.map((row) => row.ts_TraceId);

        // Fetch spans for these traces
        const tracesWithSpans = await this.fetchTracesWithSpansJoined(
          projectId,
          traceIds
        );

        // Map to Trace objects
        const traces: Trace[] = [];
        for (const row of summaryRows) {
          const traceData = tracesWithSpans.get(row.ts_TraceId);
          if (traceData) {
            const mappedSpans = mapNormalizedSpansToSpans(traceData.spans);
            const trace = mapTraceSummaryToTrace(
              traceData.summary,
              mappedSpans,
              projectId
            );
            traces.push(trace);
          } else {
            // Create trace without spans if not found
            const summary = this.rowToTraceSummaryRecord(row);
            const trace = mapTraceSummaryToTrace(summary, [], projectId);
            traces.push(trace);
          }
        }

        const lastTrace =
          traces.length > 0 ? traces[traces.length - 1] ?? null : null;

        return { traces, totalHits, lastTrace };
      }
    );
  }

  /**
   * Convert a summary row to TraceSummaryRecord.
   * @internal
   */
  private rowToTraceSummaryRecord(row: TraceSummaryRow): TraceSummaryRecord {
    return {
      TraceId: row.ts_TraceId,
      SpanCount: row.ts_SpanCount,
      TotalDurationMs: row.ts_TotalDurationMs,
      ComputedIOSchemaVersion: row.ts_ComputedIOSchemaVersion,
      ComputedInput: row.ts_ComputedInput,
      ComputedOutput: row.ts_ComputedOutput,
      TimeToFirstTokenMs: row.ts_TimeToFirstTokenMs,
      TimeToLastTokenMs: row.ts_TimeToLastTokenMs,
      TokensPerSecond: row.ts_TokensPerSecond,
      ContainsErrorStatus: row.ts_ContainsErrorStatus,
      ContainsOKStatus: row.ts_ContainsOKStatus,
      ErrorMessage: row.ts_ErrorMessage,
      Models: row.ts_Models,
      TotalCost: row.ts_TotalCost,
      TokensEstimated: row.ts_TokensEstimated,
      TotalPromptTokenCount: row.ts_TotalPromptTokenCount,
      TotalCompletionTokenCount: row.ts_TotalCompletionTokenCount,
      TopicId: row.ts_TopicId,
      SubTopicId: row.ts_SubTopicId,
      HasAnnotation: row.ts_HasAnnotation,
      Attributes: row.ts_Attributes,
      CreatedAt: row.ts_CreatedAt,
      LastUpdatedAt: row.ts_LastUpdatedAt,
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
    traceIds: string[]
  ): Promise<
    Map<string, { summary: TraceSummaryRecord; spans: NormalizedSpan[] }>
  > {
    return await this.tracer.withActiveSpan(
      "ClickHouseTraceService.fetchTracesWithSpansJoined",
      {
        attributes: { "tenant.id": projectId },
      },
      async (span) => {
        if (!this.clickHouseClient) {
          throw new Error("ClickHouse client not available");
        }

        // Query trace summaries and spans with a JOIN
        // We use LEFT JOIN to ensure we get trace summaries even if they have no spans
        const result = await this.clickHouseClient.query({
          query: `
        SELECT
          -- Trace summary fields (prefixed with ts_)
          ts.TraceId AS ts_TraceId,
          ts.SpanCount AS ts_SpanCount,
          ts.TotalDurationMs AS ts_TotalDurationMs,
          ts.ComputedIOSchemaVersion AS ts_ComputedIOSchemaVersion,
          ts.ComputedInput AS ts_ComputedInput,
          ts.ComputedOutput AS ts_ComputedOutput,
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
          ts.Attributes AS ts_Attributes,
          toUnixTimestamp64Milli(ts.CreatedAt) AS ts_CreatedAt,
          toUnixTimestamp64Milli(ts.LastUpdatedAt) AS ts_LastUpdatedAt,

          -- Span fields (prefixed with ss_)
          ss.Id AS ss_Id,
          ss.TraceId AS ss_TraceId,
          ss.SpanId AS ss_SpanId,
          ss.TenantId AS ss_TenantId,
          ss.ParentSpanId AS ss_ParentSpanId,
          ss.ParentTraceId AS ss_ParentTraceId,
          ss.ParentIsRemote AS ss_ParentIsRemote,
          ss.Sampled AS ss_Sampled,
          ss.StartTime AS ss_StartTime,
          ss.EndTime AS ss_EndTime,
          ss.DurationMs AS ss_DurationMs,
          ss.SpanName AS ss_SpanName,
          ss.SpanKind AS ss_SpanKind,
          ss.ResourceAttributes AS ss_ResourceAttributes,
          ss.SpanAttributes AS ss_SpanAttributes,
          ss.StatusCode AS ss_StatusCode,
          ss.StatusMessage AS ss_StatusMessage,
          ss.ScopeName AS ss_ScopeName,
          ss.ScopeVersion AS ss_ScopeVersion,
          arrayMap(x -> toUnixTimestamp64Milli(x), ss.\`Events.Timestamp\`) AS ss_Events_Timestamp,
          ss.\`Events.Name\` AS ss_Events_Name,
          ss.\`Events.Attributes\` AS ss_Events_Attributes,
          ss.\`Links.TraceId\` AS ss_Links_TraceId,
          ss.\`Links.SpanId\` AS ss_Links_SpanId,
          ss.\`Links.Attributes\` AS ss_Links_Attributes,
          ss.DroppedAttributesCount AS ss_DroppedAttributesCount,
          ss.DroppedEventsCount AS ss_DroppedEventsCount,
          ss.DroppedLinksCount AS ss_DroppedLinksCount
        FROM trace_summaries ts
        LEFT JOIN stored_spans ss ON ts.TenantId = ss.TenantId AND ts.TraceId = ss.TraceId
        WHERE ts.TenantId = {tenantId:String}
          AND ts.TraceId IN ({traceIds:Array(String)})
        ORDER BY ts.TraceId, ss.StartTime ASC
      `,
          query_params: {
            tenantId: projectId,
            traceIds,
          },
          format: "JSONEachRow",
        });

        const jsonResult = await result.json();
        const rows = Array.isArray(jsonResult)
          ? (jsonResult as JoinedTraceSpanRow[])
          : [];

        // Group results by TraceId
        const tracesMap = new Map<
          string,
          { summary: TraceSummaryRecord; spans: NormalizedSpan[] }
        >();

        for (const row of rows) {
          const traceId = row.ts_TraceId;

          if (!tracesMap.has(traceId)) {
            // First row for this trace - extract summary
            tracesMap.set(traceId, {
              summary: this.extractTraceSummaryFromRow(row),
              spans: [],
            });
          }

          // Add span if present (LEFT JOIN may return null span data)
          if (row.ss_SpanId) {
            const entry = tracesMap.get(traceId)!;
            entry.spans.push(this.extractSpanFromRow(row, projectId));
          }
        }

        return tracesMap;
      }
    );
  }

  /**
   * Extract TraceSummaryRecord from a joined row.
   * @internal
   */
  private extractTraceSummaryFromRow(
    row: JoinedTraceSpanRow
  ): TraceSummaryRecord {
    return {
      TraceId: row.ts_TraceId,
      SpanCount: row.ts_SpanCount,
      TotalDurationMs: row.ts_TotalDurationMs,
      ComputedIOSchemaVersion: row.ts_ComputedIOSchemaVersion,
      ComputedInput: row.ts_ComputedInput,
      ComputedOutput: row.ts_ComputedOutput,
      TimeToFirstTokenMs: row.ts_TimeToFirstTokenMs,
      TimeToLastTokenMs: row.ts_TimeToLastTokenMs,
      TokensPerSecond: row.ts_TokensPerSecond,
      ContainsErrorStatus: row.ts_ContainsErrorStatus,
      ContainsOKStatus: row.ts_ContainsOKStatus,
      ErrorMessage: row.ts_ErrorMessage,
      Models: row.ts_Models,
      TotalCost: row.ts_TotalCost,
      TokensEstimated: row.ts_TokensEstimated,
      TotalPromptTokenCount: row.ts_TotalPromptTokenCount,
      TotalCompletionTokenCount: row.ts_TotalCompletionTokenCount,
      TopicId: row.ts_TopicId,
      SubTopicId: row.ts_SubTopicId,
      HasAnnotation: row.ts_HasAnnotation,
      Attributes: row.ts_Attributes,
      CreatedAt: row.ts_CreatedAt,
      LastUpdatedAt: row.ts_LastUpdatedAt,
    };
  }

  /**
   * Extract NormalizedSpan from a joined row.
   * @internal
   */
  private extractSpanFromRow(
    row: JoinedTraceSpanRow,
    tenantId: string
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
}

/**
 * Type representing a trace summary record from ClickHouse.
 * This matches TraceSummaryData from the projection.
 */
interface TraceSummaryRecord {
  TraceId: string;
  SpanCount: number;
  TotalDurationMs: number;
  ComputedIOSchemaVersion: string;
  ComputedInput: string | null;
  ComputedOutput: string | null;
  TimeToFirstTokenMs: number | null;
  TimeToLastTokenMs: number | null;
  TokensPerSecond: number | null;
  ContainsErrorStatus: boolean;
  ContainsOKStatus: boolean;
  ErrorMessage: string | null;
  Models: string[];
  TotalCost: number | null;
  TokensEstimated: boolean;
  TotalPromptTokenCount: number | null;
  TotalCompletionTokenCount: number | null;
  TopicId: string | null;
  SubTopicId: string | null;
  HasAnnotation: boolean | null;
  Attributes: Record<string, string>;
  CreatedAt: number;
  LastUpdatedAt: number;
}

/**
 * Type for trace summary rows from the summary-only query.
 */
interface TraceSummaryRow {
  ts_TraceId: string;
  ts_SpanCount: number;
  ts_TotalDurationMs: number;
  ts_ComputedIOSchemaVersion: string;
  ts_ComputedInput: string | null;
  ts_ComputedOutput: string | null;
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
  ts_TopicId: string | null;
  ts_SubTopicId: string | null;
  ts_HasAnnotation: boolean | null;
  ts_Attributes: Record<string, string>;
  ts_CreatedAt: number;
  ts_LastUpdatedAt: number;
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
