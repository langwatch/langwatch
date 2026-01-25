/**
 * Elasticsearch Analytics Service
 *
 * Wraps the existing ES-based analytics logic to provide a consistent interface
 * for the analytics facade. This service delegates to the existing timeseries.ts
 * and router implementations.
 */

import type {
  QueryDslBoolQuery,
  QueryDslQueryContainer,
} from "@elastic/elasticsearch/lib/api/types";
import type { AggregationsAggregationContainer } from "@elastic/elasticsearch/lib/api/typesWithBodyKey";
import { esClient, TRACE_INDEX } from "../elasticsearch";
import { availableFilters } from "../filters/registry";
import type { FilterField } from "../filters/types";
import type { ElasticSearchEvent, ElasticSearchTrace } from "../tracer/types";
import { generateTracesPivotQueryConditions } from "../api/routers/analytics/common";
import { timeseries } from "./timeseries";
import type { SharedFiltersInput } from "./types";
import type { TimeseriesInputType } from "./registry";
import { createLogger } from "../../utils/logger";

const logger = createLogger("langwatch:analytics:elasticsearch");

/**
 * Timeseries result structure
 */
export interface TimeseriesResult {
  previousPeriod: TimeseriesBucket[];
  currentPeriod: TimeseriesBucket[];
}

export interface TimeseriesBucket {
  date: string;
  [key: string]: number | string | Record<string, Record<string, number>>;
}

/**
 * Filter data result
 */
export interface FilterDataResult {
  options: Array<{
    field: string;
    label: string;
    count: number;
  }>;
}

/**
 * Top documents result
 */
export interface TopDocumentsResult {
  topDocuments: Array<{
    documentId: string;
    count: number;
    traceId: string;
    content?: string;
  }>;
  totalUniqueDocuments: number;
}

/**
 * Feedbacks result
 */
export interface FeedbacksResult {
  events: ElasticSearchEvent[];
}

/**
 * Elasticsearch Analytics Service
 *
 * Provides analytics queries using Elasticsearch.
 * This is a thin wrapper around the existing timeseries.ts implementation.
 */
export class ElasticsearchAnalyticsService {
  private readonly logger = createLogger("langwatch:analytics:elasticsearch");

  /**
   * Execute timeseries query using existing ES implementation
   */
  async getTimeseries(input: TimeseriesInputType): Promise<TimeseriesResult> {
    return timeseries(input);
  }

  /**
   * Get data for filter dropdown using existing ES logic
   */
  async getDataForFilter(
    projectId: string,
    field: FilterField,
    startDate: number,
    endDate: number,
    filters: Partial<
      Record<
        FilterField,
        | string[]
        | Record<string, string[]>
        | Record<string, Record<string, string[]>>
      >
    >,
    key?: string,
    subkey?: string,
    searchQuery?: string,
  ): Promise<FilterDataResult> {
    const { pivotIndexConditions } = generateTracesPivotQueryConditions({
      projectId,
      startDate,
      endDate,
      filters: {
        // Only apply topic filters to avoid circular filtering
        ...(filters["topics.topics"]
          ? { "topics.topics": filters["topics.topics"] }
          : {}),
      },
    });

    const client = await esClient({ projectId });
    const filterConfig = availableFilters[field]!;
    const response = await client.search({
      index: TRACE_INDEX.for(startDate),
      body: {
        size: 0,
        query: pivotIndexConditions,
        aggs: filterConfig.listMatch.aggregation(
          searchQuery,
          key,
          subkey,
        ) as Record<string, AggregationsAggregationContainer>,
      },
    });

    const results = filterConfig.listMatch.extract(
      (response.aggregations ?? {}) as any,
    );

    return { options: results };
  }

  /**
   * Get top used documents (RAG analytics) using existing ES logic
   */
  async getTopUsedDocuments(
    projectId: string,
    startDate: number,
    endDate: number,
    filters: Partial<
      Record<
        FilterField,
        | string[]
        | Record<string, string[]>
        | Record<string, Record<string, string[]>>
      >
    >,
  ): Promise<TopDocumentsResult> {
    const { pivotIndexConditions } = generateTracesPivotQueryConditions({
      projectId,
      startDate,
      endDate,
      filters,
    });

    const client = await esClient({ projectId });
    const result = (await client.search<ElasticSearchTrace>({
      index: TRACE_INDEX.for(startDate),
      size: 0,
      body: {
        query: pivotIndexConditions,
        aggs: {
          nested: {
            nested: {
              path: "spans",
            },
            aggs: {
              total_unique_documents: {
                cardinality: {
                  field: "spans.contexts.document_id",
                },
              },
              top_documents: {
                terms: {
                  field: "spans.contexts.document_id",
                  size: 10,
                },
                aggs: {
                  back_to_root: {
                    reverse_nested: {},
                    aggs: {
                      top_content: {
                        top_hits: {
                          size: 1,
                          _source: {
                            includes: ["trace_id"],
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })) as any;

    const topDocuments =
      result.aggregations?.nested?.top_documents?.buckets.map(
        (bucket: any) => ({
          documentId: bucket.key,
          count: bucket.doc_count,
          traceId:
            bucket.back_to_root.top_content.hits.hits[0]._source.trace_id,
        }),
      ) as { documentId: string; count: number; traceId: string }[];

    const totalUniqueDocuments = result.aggregations?.nested
      ?.total_unique_documents?.value as number;

    // Fetch actual document content
    if (topDocuments.length > 0) {
      const documents = await client.search<ElasticSearchTrace>({
        index: TRACE_INDEX.for(startDate),
        size: topDocuments.reduce((acc, d) => acc + d.count, 0),
        body: {
          query: {
            bool: {
              must: [
                {
                  nested: {
                    path: "spans",
                    query: {
                      terms: {
                        "spans.contexts.document_id": topDocuments.map(
                          (d) => d.documentId,
                        ),
                      },
                    },
                  },
                },
                {
                  terms: {
                    trace_id: topDocuments.map((d) => d.traceId),
                  },
                },
              ] as QueryDslQueryContainer[],
            } as QueryDslBoolQuery,
          },
          _source: ["spans.contexts.document_id", "spans.contexts.content"],
        },
      });

      const documentIdToContent: Record<string, string> = {};
      for (const hit of documents.hits.hits) {
        for (const span of hit._source!.spans ?? []) {
          for (const context of span.contexts ?? []) {
            const documentId = context.document_id;
            if (typeof documentId === "string") {
              documentIdToContent[documentId] =
                typeof context.content === "string"
                  ? context.content
                  : JSON.stringify(context.content);
            }
          }
        }
      }

      return {
        topDocuments: topDocuments.map((d) => ({
          ...d,
          content: documentIdToContent[d.documentId],
        })),
        totalUniqueDocuments,
      };
    }

    return {
      topDocuments,
      totalUniqueDocuments,
    };
  }

  /**
   * Get feedbacks (thumbs up/down events with feedback text) using existing ES logic
   */
  async getFeedbacks(
    projectId: string,
    startDate: number,
    endDate: number,
    filters: Partial<
      Record<
        FilterField,
        | string[]
        | Record<string, string[]>
        | Record<string, Record<string, string[]>>
      >
    >,
  ): Promise<FeedbacksResult> {
    const { pivotIndexConditions } = generateTracesPivotQueryConditions({
      projectId,
      startDate,
      endDate,
      filters,
    });

    const client = await esClient({ projectId });
    const result = await client.search<ElasticSearchTrace>({
      index: TRACE_INDEX.for(startDate),
      size: 100,
      body: {
        _source: ["events"],
        query: {
          bool: {
            must: [
              pivotIndexConditions,
              {
                nested: {
                  path: "events",
                  query: {
                    bool: {
                      must: [
                        {
                          term: { "events.event_type": "thumbs_up_down" },
                        },
                        {
                          nested: {
                            path: "events.event_details",
                            query: {
                              bool: {
                                must: [
                                  {
                                    term: {
                                      "events.event_details.key": "feedback",
                                    },
                                  },
                                ] as QueryDslQueryContainer[],
                              } as QueryDslBoolQuery,
                            },
                          },
                        },
                      ] as QueryDslQueryContainer[],
                    } as QueryDslBoolQuery,
                  },
                },
              },
            ] as QueryDslQueryContainer[],
          } as QueryDslBoolQuery,
        },
      },
    });

    const events: ElasticSearchEvent[] = result.hits.hits
      .flatMap((hit: { _source?: ElasticSearchTrace }) => hit._source!.events ?? [])
      .filter((event: ElasticSearchEvent) =>
        event.event_details?.some((detail: { key: string; value: string }) => detail.key === "feedback"),
      )
      .map((event: ElasticSearchEvent) => ({
        ...event,
        timestamps: {
          started_at:
            "timestamps" in event
              ? event.timestamps.started_at
              : event["timestamps.started_at"],
          inserted_at:
            "timestamps" in event
              ? event.timestamps.inserted_at
              : event["timestamps.inserted_at"],
          updated_at:
            "timestamps" in event
              ? event.timestamps.updated_at
              : event["timestamps.updated_at"],
        },
      }));

    return { events };
  }
}

/**
 * Singleton instance
 */
let elasticsearchAnalyticsService: ElasticsearchAnalyticsService | null = null;

/**
 * Get the Elasticsearch analytics service instance
 */
export function getElasticsearchAnalyticsService(): ElasticsearchAnalyticsService {
  if (!elasticsearchAnalyticsService) {
    elasticsearchAnalyticsService = new ElasticsearchAnalyticsService();
  }
  return elasticsearchAnalyticsService;
}
