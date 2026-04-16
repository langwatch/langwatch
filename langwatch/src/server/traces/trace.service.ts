import type { PrismaClient } from "@prisma/client";
import { getLangWatchTracer } from "langwatch";
import { prisma as defaultPrisma } from "~/server/db";
import type { Protections } from "~/server/elasticsearch/protections";
import { mapTraceEvaluationsToLegacyEvaluations } from "~/server/evaluations/evaluation-run.mappers";
import { EvaluationService } from "~/server/evaluations/evaluation.service";
import type { Evaluation, Trace } from "~/server/tracer/types";
import { createLogger } from "~/utils/logger/server";
import { ClickHouseTraceService } from "./clickhouse-trace.service";
import { ElasticsearchTraceService } from "./elasticsearch-trace.service";
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
 * Unified service for fetching traces from ClickHouse.
 *
 * This service acts as a facade that routes all requests to the ClickHouse backend.
 *
 * @example
 * ```ts
 * const service = TraceService.create(prisma);
 * const traces = await service.getTracesWithSpans(projectId, traceIds, protections);
 * ```
 */
export class TraceService {
  private readonly tracer = getLangWatchTracer("langwatch.traces.service");
  private readonly logger = createLogger("langwatch:traces:service");
  private readonly clickHouseService: ClickHouseTraceService;
  private readonly elasticsearchService: ElasticsearchTraceService;
  private readonly evaluationService: EvaluationService;

  constructor(readonly prisma: PrismaClient) {
    this.clickHouseService = ClickHouseTraceService.create(prisma);
    this.elasticsearchService = ElasticsearchTraceService.create(prisma);
    this.evaluationService = EvaluationService.create(prisma);
  }

  /**
   * Static factory method for creating TraceService with default dependencies.
   *
   * @param prisma - PrismaClient instance
   * @returns TraceService instance
   */
  static create(prisma: PrismaClient = defaultPrisma): TraceService {
    return new TraceService(prisma);
  }

  /**
   * Get a single trace by ID.
   *
   * @param projectId - The project ID
   * @param traceId - The trace ID to fetch
   * @param protections - Field redaction protections
   * @returns The trace if found, undefined otherwise
   */
  async getById(
    projectId: string,
    traceId: string,
    protections: Protections,
  ): Promise<Trace | undefined> {
    return this.tracer.withActiveSpan(
      "TraceService.getById",
      { attributes: { "tenant.id": projectId, "trace.id": traceId } },
      async (span) => {
        span.setAttribute("backend", "clickhouse");

        const traces = await this.clickHouseService.getTracesWithSpans(
          projectId,
          [traceId],
          protections,
        );
        if (traces === null) {
          throw new Error(
            "ClickHouse is enabled but returned null for getById — check ClickHouse client configuration",
          );
        }
        return traces[0];
      },
    );
  }

  /**
   * Get traces with spans for the given trace IDs.
   *
   * @param projectId - The project ID
   * @param traceIds - Array of trace IDs to fetch
   * @param protections - Field redaction protections
   * @returns Array of Trace objects with spans
   */
  async getTracesWithSpans(
    projectId: string,
    traceIds: string[],
    protections: Protections,
  ): Promise<Trace[]> {
    return this.tracer.withActiveSpan(
      "TraceService.getTracesWithSpans",
      {
        attributes: { "tenant.id": projectId, "trace.count": traceIds.length },
      },
      async (span) => {
        span.setAttribute("backend", "clickhouse");

        const traces = await this.clickHouseService.getTracesWithSpans(
          projectId,
          traceIds,
          protections,
        );
        if (traces === null) {
          throw new Error(
            "ClickHouse is enabled but returned null for getTracesWithSpans — check ClickHouse client configuration",
          );
        }
        return traces;
      },
    );
  }

  /**
   * Get traces grouped by thread ID.
   *
   * @param projectId - The project ID
   * @param threadId - The thread ID to group by
   * @param protections - Field redaction protections
   * @returns Array of traces in the thread
   */
  async getTracesByThreadId(
    projectId: string,
    threadId: string,
    protections: Protections,
  ): Promise<Trace[]> {
    return this.tracer.withActiveSpan(
      "TraceService.getTracesByThreadId",
      { attributes: { "tenant.id": projectId, "thread.id": threadId } },
      async (span) => {
        span.setAttribute("backend", "clickhouse");

        const traces = await this.clickHouseService.getTracesByThreadId(
          projectId,
          threadId,
          protections,
        );
        if (traces === null) {
          throw new Error(
            "ClickHouse is enabled but returned null for getTracesByThreadId — check ClickHouse client configuration",
          );
        }
        return traces;
      },
    );
  }

  /**
   * Get all traces for a project with filtering and pagination.
   *
   * @param input - Query parameters including filters, pagination, and sorting
   * @param protections - Field redaction protections
   * @param options - Additional options for download mode
   * @returns TracesForProjectResult with groups, totalHits, and traceChecks
   */
  async getAllTracesForProject(
    input: GetAllTracesForProjectInput,
    protections: Protections,
    options: {
      downloadMode?: boolean;
      includeSpans?: boolean;
      scrollId?: string | null;
    } = {},
  ): Promise<TracesForProjectResult> {
    return this.tracer.withActiveSpan(
      "TraceService.getAllTracesForProject",
      { attributes: { "tenant.id": input.projectId } },
      async (span) => {
        span.setAttribute("backend", "clickhouse");

        const result = await this.clickHouseService.getAllTracesForProject(
          input,
          protections,
          options,
        );
        if (result === null) {
          throw new Error(
            "ClickHouse is enabled but returned null for getAllTracesForProject — check ClickHouse client configuration",
          );
        }

        return result;
      },
    );
  }

  /**
   * Archive traces (soft delete). Marks them as archived in ClickHouse
   * so they are excluded from all read queries.
   *
   * @param projectId - The project ID
   * @param traceIds - Array of trace IDs to archive
   * @returns The number of traces archived
   */
  async archiveTraces(
    projectId: string,
    traceIds: string[],
  ): Promise<number> {
    return this.tracer.withActiveSpan(
      "TraceService.archiveTraces",
      { attributes: { "tenant.id": projectId, "trace.count": traceIds.length } },
      async () => {
        return this.clickHouseService.archiveTraces(projectId, traceIds);
      },
    );
  }

  /**
   * Get evaluations for multiple traces.
   *
   * @param projectId - The project ID
   * @param traceIds - Array of trace IDs
   * @param protections - Field redaction protections
   * @returns Map of trace ID to evaluations
   */
  async getEvaluationsMultiple(
    projectId: string,
    traceIds: string[],
    protections: Protections,
  ): Promise<Record<string, Evaluation[]>> {
    return this.tracer.withActiveSpan(
      "TraceService.getEvaluationsMultiple",
      {
        attributes: { "tenant.id": projectId, "trace.count": traceIds.length },
      },
      async (span) => {
        span.setAttribute("backend", "clickhouse");

        const result = await this.evaluationService.getEvaluationsMultiple({
          projectId,
          traceIds,
          protections,
        });

        return mapTraceEvaluationsToLegacyEvaluations(result);
      },
    );
  }

  /**
   * Get traces with spans by thread IDs.
   *
   * @param projectId - The project ID
   * @param threadIds - Array of thread IDs
   * @param protections - Field redaction protections
   * @returns Array of traces
   */
  async getTracesWithSpansByThreadIds(
    projectId: string,
    threadIds: string[],
    protections: Protections,
  ): Promise<Trace[]> {
    return this.tracer.withActiveSpan(
      "TraceService.getTracesWithSpansByThreadIds",
      {
        attributes: {
          "tenant.id": projectId,
          "thread.count": threadIds.length,
        },
      },
      async (span) => {
        span.setAttribute("backend", "clickhouse");

        const traces =
          await this.clickHouseService.getTracesWithSpansByThreadIds(
            projectId,
            threadIds,
            protections,
          );
        if (traces === null) {
          throw new Error(
            "ClickHouse is enabled but returned null for getTracesWithSpansByThreadIds — check ClickHouse client configuration",
          );
        }
        return traces;
      },
    );
  }

  /**
   * Get topic and subtopic counts for a project with filters.
   *
   * @param input - Filter parameters including projectId and date range
   * @returns TopicCountsResult with topic and subtopic aggregations
   */
  async getTopicCounts(
    input: AggregationFiltersInput,
  ): Promise<TopicCountsResult> {
    return this.tracer.withActiveSpan(
      "TraceService.getTopicCounts",
      { attributes: { "tenant.id": input.projectId } },
      async (span) => {
        span.setAttribute("backend", "clickhouse");

        const result = await this.clickHouseService.getTopicCounts(input);
        if (result === null) {
          throw new Error(
            "ClickHouse is enabled but returned null for getTopicCounts — check ClickHouse client configuration",
          );
        }
        return result;
      },
    );
  }

  /**
   * Get unique customers and labels for a project.
   *
   * @param input - Filter parameters including projectId and date range
   * @returns CustomersAndLabelsResult with unique customer IDs and labels
   */
  async getCustomersAndLabels(
    input: AggregationFiltersInput,
  ): Promise<CustomersAndLabelsResult> {
    return this.tracer.withActiveSpan(
      "TraceService.getCustomersAndLabels",
      { attributes: { "tenant.id": input.projectId } },
      async (span) => {
        span.setAttribute("backend", "clickhouse");

        const result =
          await this.clickHouseService.getCustomersAndLabels(input);
        if (result === null) {
          throw new Error(
            "ClickHouse is enabled but returned null for getCustomersAndLabels — check ClickHouse client configuration",
          );
        }
        return result;
      },
    );
  }

  /**
   * Get distinct span names and metadata keys for a project within a date range.
   *
   * @param projectId - The project ID
   * @param startDate - Start of date range (epoch millis)
   * @param endDate - End of date range (epoch millis)
   * @returns DistinctFieldNamesResult with span names and metadata keys
   */
  async getDistinctFieldNames(
    projectId: string,
    startDate: number,
    endDate: number,
  ): Promise<DistinctFieldNamesResult> {
    return this.tracer.withActiveSpan(
      "TraceService.getDistinctFieldNames",
      { attributes: { "tenant.id": projectId } },
      async (span) => {
        span.setAttribute("backend", "clickhouse");

        const result =
          await this.clickHouseService.getDistinctFieldNames(
            projectId,
            startDate,
            endDate,
          );
        if (result === null) {
          throw new Error(
            "ClickHouse is enabled but returned null for getDistinctFieldNames — check ClickHouse client configuration",
          );
        }
        return result;
      },
    );
  }

  /**
   * Get a span for prompt studio by span ID.
   *
   * @param projectId - The project ID
   * @param spanId - The span ID to find
   * @param protections - Field redaction protections
   * @returns PromptStudioSpanResult or null if not found
   */
  async getSpanForPromptStudio(
    projectId: string,
    spanId: string,
    protections: Protections,
  ): Promise<PromptStudioSpanResult | null> {
    return this.tracer.withActiveSpan(
      "TraceService.getSpanForPromptStudio",
      { attributes: { "tenant.id": projectId, "span.id": spanId } },
      async (span) => {
        span.setAttribute("backend", "clickhouse");

        return this.clickHouseService.getSpanForPromptStudio(
          projectId,
          spanId,
          protections,
        );
      },
    );
  }
}
