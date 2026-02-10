import type { PrismaClient } from "@prisma/client";
import { getLangWatchTracer } from "langwatch";
import { prisma as defaultPrisma } from "~/server/db";
import type { Protections } from "~/server/elasticsearch/protections";
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
 * Unified service for fetching traces from either ClickHouse or Elasticsearch.
 *
 * This service acts as a facade that:
 * 1. Checks if ClickHouse Traces Data Source is enabled for the project (via featureClickHouseDataSourceTraces flag)
 * 2. Routes requests to the appropriate backend based on the feature flag
 * 3. Applies consistent protections/redaction to all responses
 *
 * @example
 * ```ts
 * const service = TraceService.create(prisma);
 * const traces = await service.getTracesWithSpans(projectId, traceIds, protections);
 * ```
 */
export class TraceService {
  private readonly logger = createLogger("langwatch:traces:service");
  private readonly tracer = getLangWatchTracer("langwatch.traces.service");
  private readonly clickHouseService: ClickHouseTraceService;
  private readonly elasticsearchService: ElasticsearchTraceService;

  constructor(readonly prisma: PrismaClient) {
    this.clickHouseService = ClickHouseTraceService.create(prisma);
    this.elasticsearchService = ElasticsearchTraceService.create(prisma);
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
   * Check if ClickHouse is enabled for the given project.
   *
   * @param projectId - The project ID
   * @returns True if ClickHouse is enabled, false otherwise
   */
  async isClickHouseEnabled(projectId: string): Promise<boolean> {
    return this.clickHouseService.isClickHouseEnabled(projectId);
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
        const useClickHouse = await this.isClickHouseEnabled(projectId);
        span.setAttribute(
          "backend",
          useClickHouse ? "clickhouse" : "elasticsearch",
        );

        if (useClickHouse) {
          const traces = await this.clickHouseService.getTracesWithSpans(
            projectId,
            [traceId],
            protections,
          );
          return traces?.[0];
        }

        return this.elasticsearchService.getById(
          projectId,
          traceId,
          protections,
        );
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
        const useClickHouse = await this.isClickHouseEnabled(projectId);
        span.setAttribute(
          "backend",
          useClickHouse ? "clickhouse" : "elasticsearch",
        );

        if (useClickHouse) {
          const traces = await this.clickHouseService.getTracesWithSpans(
            projectId,
            traceIds,
            protections,
          );
          return traces ?? [];
        }

        return this.elasticsearchService.getTracesWithSpans(
          projectId,
          traceIds,
          protections,
        );
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
        const useClickHouse = await this.isClickHouseEnabled(projectId);
        span.setAttribute(
          "backend",
          useClickHouse ? "clickhouse" : "elasticsearch",
        );

        if (useClickHouse) {
          const traces = await this.clickHouseService.getTracesByThreadId(
            projectId,
            threadId,
            protections,
          );
          if (traces !== null) {
            return traces;
          }
          // Fall back to Elasticsearch if ClickHouse returns null
          this.logger.warn(
            { projectId, threadId },
            "ClickHouse enabled but returned null for getTracesByThreadId, falling back to Elasticsearch",
          );
        }

        return this.elasticsearchService.getTracesByThreadId(
          projectId,
          threadId,
          protections,
        );
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
        const useClickHouse = await this.isClickHouseEnabled(input.projectId);
        span.setAttribute(
          "backend",
          useClickHouse ? "clickhouse" : "elasticsearch",
        );

        if (useClickHouse) {
          const result = await this.clickHouseService.getAllTracesForProject(
            input,
            protections,
          );
          if (result !== null) {
            return result;
          }
          // If ClickHouse returns null (e.g., client not available), fall back
          this.logger.warn(
            { projectId: input.projectId },
            "ClickHouse enabled but returned null, falling back to Elasticsearch",
          );
        }

        return this.elasticsearchService.getAllTracesForProject(
          input,
          protections,
          options,
        );
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
      async () => {
        // Evaluations are only in Elasticsearch for now
        return this.elasticsearchService.getEvaluationsMultiple(
          projectId,
          traceIds,
          protections,
        );
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
        const useClickHouse = await this.isClickHouseEnabled(projectId);
        span.setAttribute(
          "backend",
          useClickHouse ? "clickhouse" : "elasticsearch",
        );

        if (useClickHouse) {
          const traces =
            await this.clickHouseService.getTracesWithSpansByThreadIds(
              projectId,
              threadIds,
              protections,
            );
          if (traces !== null) {
            return traces;
          }
          // Fall back to Elasticsearch if ClickHouse returns null
          this.logger.warn(
            { projectId, threadIds },
            "ClickHouse enabled but returned null for getTracesWithSpansByThreadIds, falling back to Elasticsearch",
          );
        }

        return this.elasticsearchService.getTracesWithSpansByThreadIds(
          projectId,
          threadIds,
          protections,
        );
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
        const useClickHouse = await this.isClickHouseEnabled(input.projectId);
        span.setAttribute(
          "backend",
          useClickHouse ? "clickhouse" : "elasticsearch",
        );

        if (useClickHouse) {
          const result = await this.clickHouseService.getTopicCounts(input);
          if (result !== null) {
            return result;
          }
          this.logger.warn(
            { projectId: input.projectId },
            "ClickHouse enabled but returned null for getTopicCounts, falling back to Elasticsearch",
          );
        }

        return this.elasticsearchService.getTopicCounts(input);
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
        const useClickHouse = await this.isClickHouseEnabled(input.projectId);
        span.setAttribute(
          "backend",
          useClickHouse ? "clickhouse" : "elasticsearch",
        );

        if (useClickHouse) {
          const result =
            await this.clickHouseService.getCustomersAndLabels(input);
          if (result !== null) {
            return result;
          }
          this.logger.warn(
            { projectId: input.projectId },
            "ClickHouse enabled but returned null for getCustomersAndLabels, falling back to Elasticsearch",
          );
        }

        return this.elasticsearchService.getCustomersAndLabels(input);
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
        const useClickHouse = await this.isClickHouseEnabled(projectId);
        span.setAttribute(
          "backend",
          useClickHouse ? "clickhouse" : "elasticsearch",
        );

        if (useClickHouse) {
          const result =
            await this.clickHouseService.getDistinctFieldNames(
              projectId,
              startDate,
              endDate,
            );
          if (result !== null) {
            return result;
          }
          this.logger.warn(
            { projectId },
            "ClickHouse enabled but returned null for getDistinctFieldNames, falling back to Elasticsearch",
          );
        }

        return this.elasticsearchService.getDistinctFieldNames(
          projectId,
          startDate,
          endDate,
        );
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
        const useClickHouse = await this.isClickHouseEnabled(projectId);
        span.setAttribute(
          "backend",
          useClickHouse ? "clickhouse" : "elasticsearch",
        );

        if (useClickHouse) {
          const result = await this.clickHouseService.getSpanForPromptStudio(
            projectId,
            spanId,
            protections,
          );
          if (result !== null) {
            return result;
          }
          // Fall back to Elasticsearch - span might not be found in ClickHouse
          this.logger.debug(
            { projectId, spanId },
            "Span not found in ClickHouse, falling back to Elasticsearch",
          );
        }

        return this.elasticsearchService.getSpanForPromptStudio(
          projectId,
          spanId,
          protections,
        );
      },
    );
  }
}
