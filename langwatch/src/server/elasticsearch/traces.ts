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
  const client = await esClient(connConfig);
  const result = await client.search<ElasticSearchTrace>({
    index,
    size,
    ...searchParams
  });

  const traces = result.hits.hits
    .map((hit) => hit._source!)
    .filter((x) => x)
    .map((t) => transformElasticSearchTraceToTrace(t, protections));

  return traces;
}

interface AggregateTracesOptions<T extends Record<string, T.AggregationsAggregationContainer>> {
  connConfig: ConnectionConfig;
  search: Parameters<ElasticClient['search']>[0] & {
    index?: typeof TRACE_INDEX[keyof typeof TRACE_INDEX];
    size?: 0;
    aggs: T;
  };
  protections?: Protections;
}

export async function aggregateTraces<T extends Record<string, T.AggregationsAggregationContainer>>({
  connConfig,
  search: {
    index = TRACE_INDEX.alias,
    size = 0,
    aggs,
    ...searchParams
  },
  protections = {}, // I don't think we need protections here, but good to have for future?
}: AggregateTracesOptions<T>): Promise<Record<keyof T, (T.AggregationsMultiBucketBase & { key: string })[]>> {
  const client = await esClient(connConfig);
  const result = await client.search<unknown, Record<keyof T, T.AggregationsMultiBucketAggregateBase<T.AggregationsMultiBucketBase & { key: string }>>>({
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
  ) as Record<keyof T, (T.AggregationsMultiBucketBase & { key: string })[]>;

  if (result.aggregations) {
    for (const key in result.aggregations) {
      out[key] = getBucketsFromAggregation(result.aggregations[key]);
    }
  }

  return out;
}

