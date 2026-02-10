import type {
  SearchResponse,
  SearchTotalHits,
  Sort,
} from "@elastic/elasticsearch/lib/api/types";
import type { PrismaClient } from "@prisma/client";
import type { TraceWithGuardrail } from "~/components/messages/MessageCard";
import { generateTracesPivotQueryConditions } from "~/server/api/routers/analytics/common";
import { esClient, TRACE_INDEX } from "~/server/elasticsearch";
import type { Protections } from "~/server/elasticsearch/protections";
import {
  aggregateTraces,
  getDistinctFieldNames as esGetDistinctFieldNames,
  getTraceById as esGetTraceById,
  getTracesGroupedByThreadId as esGetTracesGroupedByThreadId,
  searchTraces,
} from "~/server/elasticsearch/traces";
import { transformElasticSearchTraceToTrace } from "~/server/elasticsearch/transformers";
import type {
  ElasticSearchTrace,
  Evaluation,
  LLMSpan,
  Trace,
} from "~/server/tracer/types";
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
 * Service for fetching traces from Elasticsearch.
 *
 * This service wraps the existing Elasticsearch trace functions and provides
 * a consistent interface matching ClickHouseTraceService.
 *
 * @example
 * ```ts
 * const service = ElasticsearchTraceService.create(prisma);
 * const traces = await service.getTracesWithSpans(projectId, traceIds, protections);
 * ```
 */
export class ElasticsearchTraceService {
  constructor(readonly _prisma: PrismaClient) {}

  /**
   * Static factory method for creating ElasticsearchTraceService with default dependencies.
   *
   * @param prisma - PrismaClient instance
   * @returns ElasticsearchTraceService instance
   */
  static create(prisma: PrismaClient): ElasticsearchTraceService {
    return new ElasticsearchTraceService(prisma);
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
    return esGetTraceById({
      connConfig: { projectId },
      traceId,
      includeEvaluations: false,
      includeSpans: false,
      protections,
    });
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
    const traces = await searchTraces({
      connConfig: { projectId },
      protections,
      search: {
        index: TRACE_INDEX.all,
        size: 1000,
        query: {
          bool: {
            filter: [
              { term: { project_id: projectId } },
              { terms: { trace_id: traceIds } },
            ],
            should: void 0,
            must_not: void 0,
          },
        },
        sort: [
          {
            "timestamps.started_at": {
              order: "asc",
            },
          },
        ],
        _source: {
          excludes: [
            "input.embeddings",
            "input.embeddings.embeddings",
            "output.embeddings",
            "output.embeddings.embeddings",
          ],
        },
      },
    });

    return traces;
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
    return esGetTracesGroupedByThreadId({
      connConfig: { projectId },
      threadId,
      protections,
    });
  }

  /**
   * Get all traces for a project with filtering and pagination.
   *
   * @param input - Query parameters including filters, pagination, and sorting
   * @param ctx - Context with prisma, session, and publiclyShared flag
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
    const { downloadMode = false, includeSpans = false, scrollId } = options;

    const { pivotIndexConditions } = generateTracesPivotQueryConditions({
      ...input,
    });

    let pageSize = input.pageSize ?? 25;
    const pageOffset = input.pageOffset ?? 0;

    if (input.updatedAt !== undefined && input.updatedAt >= 0) {
      pageSize = 10_000;
    }

    let tracesResult: SearchResponse<ElasticSearchTrace>;
    if (scrollId) {
      const client = await esClient({ projectId: input.projectId });
      tracesResult = await client.scroll({
        scroll_id: scrollId,
        scroll: "1m",
      });
    } else {
      const client = await esClient({ projectId: input.projectId });
      tracesResult = await client.search<ElasticSearchTrace>({
        index: TRACE_INDEX.for(input.startDate),
        from: downloadMode ? undefined : pageOffset,
        size: pageSize,
        scroll: downloadMode ? "1m" : undefined,
        _source: {
          excludes: [
            "input.embeddings",
            "input.embeddings.embeddings",
            "output.embeddings",
            "output.embeddings.embeddings",
            ...(includeSpans ? [] : ["spans"]),
          ],
        },
        body: {
          query: pivotIndexConditions,
          ...this.buildSortClause(input.sortBy, input.sortDirection),
        },
      });
    }

    const traces = tracesResult.hits.hits
      .map((hit) => hit._source!)
      .map((t) => transformElasticSearchTraceToTrace(t, protections));

    // Handle thread_id grouping
    if (input.groupBy === "thread_id") {
      await this.enrichTracesWithThreadGroup(
        traces,
        input.projectId,
        protections,
      );

      if (!input.sortBy) {
        this.sortTracesByTimestampDesc(traces);
      }
    }

    const totalHits = (tracesResult.hits?.total as SearchTotalHits)?.value || 0;

    const evaluations = Object.fromEntries(
      traces.map((trace) => [trace.trace_id, trace.evaluations ?? []]),
    );

    const tracesWithGuardrails = this.transformTracesWithGuardrails(traces);
    const groups = this.groupTraces(input.groupBy, tracesWithGuardrails);

    return {
      groups,
      totalHits,
      traceChecks: evaluations,
      scrollId: tracesResult._scroll_id,
    };
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
    const traces = await searchTraces({
      connConfig: { projectId },
      search: {
        index: TRACE_INDEX.all,
        size: Math.min(traceIds.length * 100, 10_000),
        _source: ["trace_id", "evaluations"],
        query: {
          bool: {
            filter: [
              { terms: { trace_id: traceIds } },
              { term: { project_id: projectId } },
            ],
            should: void 0,
            must_not: void 0,
          },
        },
      },
      protections,
    });

    return Object.fromEntries(
      traces.map((trace) => [trace.trace_id, trace.evaluations ?? []]),
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
    const traces = await searchTraces({
      connConfig: { projectId },
      protections,
      search: {
        index: TRACE_INDEX.all,
        size: 1000,
        query: {
          bool: {
            filter: [
              { term: { project_id: projectId } },
              { terms: { "metadata.thread_id": threadIds } },
            ],
            should: void 0,
            must_not: void 0,
          },
        },
        sort: [
          {
            "timestamps.started_at": {
              order: "asc",
            },
          },
        ],
        _source: {
          excludes: [
            "input.embeddings",
            "input.embeddings.embeddings",
            "output.embeddings",
            "output.embeddings.embeddings",
          ],
        },
      },
    });

    return traces;
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
    const { pivotIndexConditions } = generateTracesPivotQueryConditions(input);

    const result = await aggregateTraces({
      connConfig: { projectId: input.projectId },
      search: {
        index: TRACE_INDEX.for(input.startDate),
        query: {
          bool: {
            must: pivotIndexConditions,
            should: void 0,
            must_not: void 0,
            filter: void 0,
          },
        },
        aggs: {
          topicCounts: {
            terms: {
              field: "metadata.topic_id",
              size: 10000,
            },
          },
          subtopicCounts: {
            terms: {
              field: "metadata.subtopic_id",
              size: 10000,
            },
          },
        },
      },
    });

    return {
      topicCounts: result.topicCounts.map((bucket) => ({
        key: bucket.key,
        count: bucket.doc_count,
      })),
      subtopicCounts: result.subtopicCounts.map((bucket) => ({
        key: bucket.key,
        count: bucket.doc_count,
      })),
    };
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
    const result = await aggregateTraces({
      connConfig: { projectId: input.projectId },
      search: {
        index: TRACE_INDEX.for(input.startDate),
        query: {
          term: {
            project_id: input.projectId,
          },
        },
        aggs: {
          customers: {
            terms: {
              field: "metadata.customer_id",
              size: 10000,
            },
          },
          labels: {
            terms: {
              field: "metadata.labels",
              size: 10000,
            },
          },
        },
      },
    });

    return {
      customers: result.customers.map((bucket) => bucket.key),
      labels: result.labels.map((bucket) => bucket.key),
    };
  }

  /**
   * Get a span for prompt studio by span ID.
   * Searches for an LLM span and returns the data needed for prompt studio.
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
    // Find the trace containing this span using nested query
    const traces = await searchTraces({
      connConfig: { projectId },
      protections,
      search: {
        index: TRACE_INDEX.all,
        size: 1,
        query: {
          bool: {
            filter: [
              { term: { project_id: projectId } },
              {
                nested: {
                  path: "spans",
                  query: {
                    bool: {
                      must: [
                        { term: { "spans.span_id": spanId } },
                        { term: { "spans.type": "llm" } },
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
      },
    });

    const trace = traces[0];
    if (!trace) {
      return null;
    }

    const span = trace.spans?.find((s) => s.span_id === spanId);
    if (!span || span.type !== "llm") {
      return null;
    }

    return this.extractPromptStudioData(trace, span as LLMSpan);
  }

  /**
   * Extract prompt studio data from a trace and LLM span.
   * @internal
   */
  private extractPromptStudioData(
    trace: Trace,
    span: LLMSpan,
  ): PromptStudioSpanResult {
    const messages: PromptStudioSpanResult["messages"] = [];

    // Handle input: convert all input types to chat messages
    if (
      span.input?.type === "chat_messages" &&
      Array.isArray(span.input.value)
    ) {
      messages.push(...span.input.value);
    } else if (typeof span.input?.value === "string") {
      messages.push({ role: "user", content: span.input.value });
    } else if (span.input?.value != null) {
      messages.push({
        role: "user",
        content: JSON.stringify(span.input.value),
      });
    }

    // Handle output: convert all output types to chat messages
    if (
      span.output?.type === "chat_messages" &&
      Array.isArray(span.output.value)
    ) {
      messages.push(...span.output.value);
    } else if (
      span.output?.type === "json" &&
      Array.isArray(span.output.value) &&
      span.output.value.length > 0 &&
      typeof span.output.value[0] === "string"
    ) {
      messages.push({
        role: "assistant",
        content: span.output.value[0],
      });
    } else if (span.output?.value) {
      const content =
        typeof span.output.value === "string"
          ? span.output.value
          : JSON.stringify(span.output.value);
      messages.push({ role: "assistant", content });
    }

    // Extract LLM config
    const params = span.params ?? {};
    const systemPrompt = messages.find((m) => m.role === "system")?.content;
    const litellmParams: Record<string, unknown> = {};

    const excludeKeys = new Set([
      "temperature",
      "max_tokens",
      "maxTokens",
      "top_p",
      "topP",
      "_keys",
    ]);
    for (const [key, value] of Object.entries(params)) {
      if (!excludeKeys.has(key)) {
        litellmParams[key] = value;
      }
    }

    return {
      spanId: span.span_id,
      traceId: trace.trace_id,
      spanName: span.name ?? null,
      messages,
      llmConfig: {
        model: span.model ?? null,
        systemPrompt,
        temperature: (params.temperature as number) ?? null,
        maxTokens: ((params.max_tokens ?? params.maxTokens) as number) ?? null,
        topP: ((params.top_p ?? params.topP) as number) ?? null,
        litellmParams,
      },
      vendor: span.vendor ?? null,
      error: span.error ?? null,
      timestamps: span.timestamps,
      metrics: span.metrics ?? null,
    };
  }

  /**
   * Build sort clause for ES query.
   * @internal
   */
  private buildSortClause(
    sortBy?: string,
    sortDirection?: string,
  ): { sort: Sort } {
    if (!sortBy) {
      return {
        sort: {
          "timestamps.started_at": {
            order: "desc",
          },
        } as Sort,
      };
    }

    if (sortBy.startsWith("random.")) {
      return {
        sort: {
          _script: {
            type: "number",
            script: {
              source: "Math.random()",
            },
            order: sortDirection ?? "desc",
          },
        } as Sort,
      };
    }

    if (sortBy.startsWith("evaluations.")) {
      return {
        sort: {
          "evaluations.score": {
            order: sortDirection ?? "desc",
            nested: {
              path: "evaluations",
              filter: {
                term: {
                  "evaluations.evaluator_id": sortBy.split(".")[1],
                },
              },
            },
          },
        } as Sort,
      };
    }

    return {
      sort: {
        [sortBy]: {
          order: sortDirection ?? "desc",
        },
      } as Sort,
    };
  }

  /**
   * Enrich traces with additional traces from the same threads.
   * @internal
   */
  private async enrichTracesWithThreadGroup(
    traces: Trace[],
    projectId: string,
    protections: Protections,
  ): Promise<void> {
    const threadIds = traces.map((t) => t.metadata.thread_id).filter(Boolean);
    const existingTraceIds = new Set(traces.map((t) => t.trace_id));

    if (threadIds.length > 0) {
      const tracesFromThreadId = await searchTraces({
        connConfig: { projectId },
        search: {
          index: TRACE_INDEX.all,
          size: 50,
          query: {
            bool: {
              filter: [
                { terms: { "metadata.thread_id": threadIds } },
                { term: { project_id: projectId } },
              ],
              should: void 0,
              must_not: void 0,
            },
          },
        },
        protections,
      });

      const filteredTracesByThreadId = tracesFromThreadId.filter(
        (trace) => !existingTraceIds.has(trace.trace_id),
      );

      traces.unshift(...filteredTracesByThreadId);
    }
  }

  /**
   * Sort traces by timestamp in descending order.
   * @internal
   */
  private sortTracesByTimestampDesc(traces: Trace[]): void {
    traces.sort((a, b) => {
      const timeA = a.timestamps?.started_at;
      const timeB = b.timestamps?.started_at;

      const dateAValue = timeA ? new Date(timeA).getTime() : NaN;
      const dateBValue = timeB ? new Date(timeB).getTime() : NaN;

      const aIsNaN = Number.isNaN(dateAValue);
      const bIsNaN = Number.isNaN(dateBValue);

      if (aIsNaN && bIsNaN) return 0;
      if (aIsNaN) return 1;
      if (bIsNaN) return -1;

      return dateBValue - dateAValue;
    });
  }

  /**
   * Transform traces to include guardrail information.
   * @internal
   */
  private transformTracesWithGuardrails(traces: Trace[]): TraceWithGuardrail[] {
    return traces.map((trace) => ({
      ...trace,
      lastGuardrail: void 0,
      annotations: void 0,
    }));
  }

  /**
   * Group traces by the specified field.
   * @internal
   */
  private groupTraces<T extends Trace>(
    groupBy: string | undefined,
    traces: T[],
  ): T[][] {
    const groups: T[][] = [];

    const groupingKeyPresent = (trace: T) => {
      if (groupBy === "user_id") {
        return !!trace.metadata.user_id;
      }
      if (groupBy === "thread_id") {
        return !!trace.metadata.thread_id;
      }
      return false;
    };

    const matchesGroup = (trace: T, member: T) => {
      if (groupBy === "user_id") {
        return trace.metadata.user_id === member.metadata.user_id;
      }
      if (groupBy === "thread_id") {
        return trace.metadata.thread_id === member.metadata.thread_id;
      }
      return false;
    };

    for (const trace of traces) {
      if (!groupingKeyPresent(trace)) {
        groups.push([trace]);
        continue;
      }

      let grouped = false;
      for (const group of groups) {
        for (const member of group) {
          if (!groupingKeyPresent(member)) continue;

          if (matchesGroup(trace, member)) {
            group.push(trace);
            grouped = true;
            break;
          }
        }
        if (grouped) break;
      }
      if (!grouped) {
        groups.push([trace]);
      }
    }

    return groups;
  }

  /**
   * Get distinct span names and metadata keys for a project.
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
    return esGetDistinctFieldNames({
      connConfig: { projectId },
      startDate,
      endDate,
    });
  }
}
