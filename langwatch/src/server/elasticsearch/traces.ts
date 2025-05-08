import * as T from '@elastic/elasticsearch/lib/api/types'
import { Client as ElasticClient } from "@elastic/elasticsearch";
import {
  type ElasticSearchTrace,
  type Trace,
} from "../tracer/types";
import { TRACE_INDEX, esClient } from "../elasticsearch";
import type { Protections } from "./protections";
import { transformElasticSearchTraceToTrace } from "./transformers";

interface ProjectConnectionConfig {
  projectId: string;
}
interface OrganizationConnectionConfig {
  organizationId: string;
}
interface TestConnectionConfig {
  test: true;
}

type ConnectionConfig = ProjectConnectionConfig | OrganizationConnectionConfig | TestConnectionConfig;

interface SearchTracesWithInternalsOptions {
  connConfig: ConnectionConfig;
  search: Parameters<ElasticClient['search']>[0] & {
    index?: typeof TRACE_INDEX[keyof typeof TRACE_INDEX];
    size?: number;
  };
  protections: Protections;
}

export async function searchTracesWithInternals({
  connConfig,
  search: {
    index = TRACE_INDEX.alias,
    size = 10,
    ...searchParams
  },
  protections = {},
}: SearchTracesWithInternalsOptions): Promise<{ trace: Trace, hit: T.SearchHit, source: ElasticSearchTrace }[]> {
  const client = await esClient(connConfig);
  const result = await client.search<ElasticSearchTrace>({
    index,
    size,
    ...searchParams
  });

  return result.hits.hits
    .filter((hit) => hit._source)
    .map((hit) => ({
      trace: transformElasticSearchTraceToTrace(hit._source!, protections),
      hit,
      source: hit._source!,
    }));
}

interface SearchTracesOptions {
  connConfig: ConnectionConfig;
  search: Parameters<ElasticClient['search']>[0] & {
    index?: typeof TRACE_INDEX[keyof typeof TRACE_INDEX];
    size?: number;
  };
  protections: Protections;
}

export async function searchTraces({
  connConfig,
  search: {
    index = TRACE_INDEX.alias,
    size = 10,
    ...searchParams
  },
  protections = {},
}: SearchTracesOptions): Promise<Trace[]> {
  const tracesWithInternals = await searchTracesWithInternals({
    connConfig,
    search: {
      index,
      size,
      ...searchParams
    },
    protections,
  });

  return tracesWithInternals.map(({ trace }) => trace);
}

interface AggregateTracesOptions<Aggs extends Record<string, T.AggregationsAggregationContainer>> {
  connConfig: ConnectionConfig;
  search: Parameters<ElasticClient['search']>[0] & {
    index?: typeof TRACE_INDEX[keyof typeof TRACE_INDEX];
    size?: 0;
    aggs: Aggs;
  };
  protections?: Protections;
}

export async function aggregateTraces<Aggs extends Record<string, T.AggregationsAggregationContainer>>({
  connConfig,
  search: {
    index = TRACE_INDEX.alias,
    size = 0,
    aggs,
    ...searchParams
  },
  protections = {}, // I don't think we need protections here, but good to have for future?
}: AggregateTracesOptions<Aggs>): Promise<Record<keyof Aggs, (T.AggregationsMultiBucketBase & { key: string })[]>> {
  const client = await esClient(connConfig);
  const result = await client.search<
    unknown,
    Record<
      keyof Aggs,
      T.AggregationsMultiBucketAggregateBase<T.AggregationsMultiBucketBase & { key: string }>
    >
  >({
    index,
    size,
    aggs,
    ...searchParams
  });

  const getBucketsFromAggregation = (
    aggregation: T.AggregationsMultiBucketAggregateBase<T.AggregationsMultiBucketBase & { key: string }>
  ): (T.AggregationsMultiBucketBase & { key: string })[] => {
    if (
      aggregation &&
      'buckets' in aggregation &&
      Array.isArray(aggregation.buckets)
    ) {
      return aggregation.buckets;
    }

    return [];
  };

  // Initialize output with empty arrays for all keys in the input aggs, to avoid missing key errors
  const out = Object.fromEntries(
    Object.keys(aggs).map(key => [key, [] as (T.AggregationsMultiBucketBase & { key: string })[]])
  ) as Record<keyof Aggs, (T.AggregationsMultiBucketBase & { key: string })[]>;

  if (result.aggregations) {
    for (const key in result.aggregations) {
      out[key] = getBucketsFromAggregation(result.aggregations[key]);
    }
  }

  return out;
}

interface GetTraceByIdOptions {
  connConfig: ProjectConnectionConfig;
  traceId: string;
  protections: Protections;

  includeEvaluations?: boolean;
  includeSpans?: boolean;
}

export const getTraceById = async ({
  connConfig,
  traceId,
  protections,
  includeEvaluations = false,
  includeSpans = false,
}: GetTraceByIdOptions): Promise<Trace | undefined> => {
  const traces = await searchTraces({
    connConfig,
    search: {
      index: TRACE_INDEX.alias,
      size: 1,
      _source: {
        excludes: [
          "input.embeddings",
          "input.embeddings.embeddings",
          "output.embeddings",
          "output.embeddings.embeddings",
          ...(includeEvaluations ? [] : ["evaluations"]),
          ...(includeSpans ? [] : ["spans"]),
        ],
      },
      query: {
        bool: {
          filter: [
            { term: { trace_id: traceId } },
            { term: { project_id: connConfig.projectId } },
          ],
          should: void 0,
          must_not: void 0,
        },
      },
    },
    protections,
  });

  return traces[0];
};

interface GetTracesGroupedByThreadIdOptions {
  connConfig: ProjectConnectionConfig;
  threadId: string;
  protections: Protections;

  includeEvaluations?: boolean;
  includeSpans?: boolean;
}

export const getTracesGroupedByThreadId = async ({
  connConfig,
  threadId,
  protections,
  includeEvaluations = false,
  includeSpans = false,
}: GetTracesGroupedByThreadIdOptions): Promise<Trace[]> => {
  const traces = await searchTraces({
    connConfig,
    search: {
      size: 1000,
      _source: {
        excludes: [
          "input.embeddings",
          "input.embeddings.embeddings",
          "output.embeddings",
          "output.embeddings.embeddings",
          ...(includeEvaluations ? [] : ["evaluations"]),
          ...(includeSpans ? [] : ["spans"]),
        ],
      },
      query: {
        bool: {
          filter: [
            { term: { project_id: connConfig.projectId } },
            { term: { "metadata.thread_id": threadId } },
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
    },
    protections,
  });

  return traces;
};
