import type { Client as ElasticClient } from "@elastic/elasticsearch";
import type * as T from "@elastic/elasticsearch/lib/api/types";
import { esClient, TRACE_INDEX } from "../elasticsearch";
import type { ElasticSearchTrace, Trace } from "../tracer/types";
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

type ConnectionConfig =
  | ProjectConnectionConfig
  | OrganizationConnectionConfig
  | TestConnectionConfig;

interface SearchTracesWithInternalsOptions {
  connConfig: ConnectionConfig;
  search: Parameters<ElasticClient["search"]>[0] & {
    index?: (typeof TRACE_INDEX)[keyof typeof TRACE_INDEX];
    size?: number;
  };
  protections: Protections;
}

export async function searchTracesWithInternals({
  connConfig,
  search: { index = TRACE_INDEX.alias, size = 10, ...searchParams },
  protections = {},
}: SearchTracesWithInternalsOptions): Promise<
  { trace: Trace; hit: T.SearchHit; source: ElasticSearchTrace }[]
> {
  const client = await esClient(connConfig);
  const result = await client.search<ElasticSearchTrace>({
    index,
    size,
    ...searchParams,
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
  search: Parameters<ElasticClient["search"]>[0] & {
    index?: (typeof TRACE_INDEX)[keyof typeof TRACE_INDEX];
    size?: number;
  };
  protections: Protections;
}

export async function searchTraces({
  connConfig,
  search: { index = TRACE_INDEX.alias, size = 10, ...searchParams },
  protections = {},
}: SearchTracesOptions): Promise<Trace[]> {
  const tracesWithInternals = await searchTracesWithInternals({
    connConfig,
    search: {
      index,
      size,
      ...searchParams,
    },
    protections,
  });

  return tracesWithInternals.map(({ trace }) => trace);
}

interface AggregateTracesOptions<
  Aggs extends Record<string, T.AggregationsAggregationContainer>,
> {
  connConfig: ConnectionConfig;
  search: Parameters<ElasticClient["search"]>[0] & {
    index?: (typeof TRACE_INDEX)[keyof typeof TRACE_INDEX];
    size?: 0;
    aggs: Aggs;
  };
  protections?: Protections;
}

export async function aggregateTraces<
  Aggs extends Record<string, T.AggregationsAggregationContainer>,
>({
  connConfig,
  search: { index = TRACE_INDEX.alias, size = 0, aggs, ...searchParams },
  protections = {}, // I don't think we need protections here, but good to have for future?
}: AggregateTracesOptions<Aggs>): Promise<
  Record<keyof Aggs, (T.AggregationsMultiBucketBase & { key: string })[]>
> {
  const client = await esClient(connConfig);
  const result = await client.search<
    unknown,
    Record<
      keyof Aggs,
      T.AggregationsMultiBucketAggregateBase<
        T.AggregationsMultiBucketBase & { key: string }
      >
    >
  >({
    index,
    size,
    aggs,
    ...searchParams,
  });

  const getBucketsFromAggregation = (
    aggregation: T.AggregationsMultiBucketAggregateBase<
      T.AggregationsMultiBucketBase & { key: string }
    >,
  ): (T.AggregationsMultiBucketBase & { key: string })[] => {
    if (
      aggregation &&
      "buckets" in aggregation &&
      Array.isArray(aggregation.buckets)
    ) {
      return aggregation.buckets;
    }

    return [];
  };

  // Initialize output with empty arrays for all keys in the input aggs, to avoid missing key errors
  const out = Object.fromEntries(
    Object.keys(aggs).map((key) => [
      key,
      [] as (T.AggregationsMultiBucketBase & { key: string })[],
    ]),
  ) as Record<keyof Aggs, (T.AggregationsMultiBucketBase & { key: string })[]>;

  if (result.aggregations) {
    Object.entries(result.aggregations).forEach(([key, value]) => {
      out[key as keyof Aggs] = getBucketsFromAggregation(value);
    });
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
      index: TRACE_INDEX.all,
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
      index: TRACE_INDEX.all,
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

/**
 * Get distinct span names and metadata keys for a project within a date range.
 *
 * - Metadata keys: efficient terms aggregation on the `metadata.all_keys` keyword field
 * - Span names: nested terms aggregation on `spans.model` (keyword) combined with
 *   a lightweight search for span `name` fields from a sample of traces.
 *   This is needed because `spans.name` is a text field (not aggregatable).
 */
export async function getDistinctFieldNames({
  connConfig,
  startDate,
  endDate,
}: {
  connConfig: ProjectConnectionConfig;
  startDate: number;
  endDate: number;
}): Promise<{
  spanNames: Array<{ key: string; label: string }>;
  metadataKeys: Array<{ key: string; label: string }>;
}> {
  const client = await esClient(connConfig);

  const dateFilter = {
    range: {
      "timestamps.started_at": {
        gte: startDate,
        lte: endDate,
        format: "epoch_millis",
      },
    },
  };

  const projectFilter = { term: { project_id: connConfig.projectId } };

  // Run two queries in parallel:
  // 1. Aggregation for metadata keys (keyword field, very efficient)
  //    + span models (keyword, nested)
  // 2. Lightweight search for span names (text field, need to sample documents)
  const [aggsResult, spansResult] = await Promise.all([
    client.search({
      index: TRACE_INDEX.alias,
      size: 0,
      query: { bool: { filter: [projectFilter, dateFilter] } },
      aggs: {
        metadata_keys: {
          terms: {
            field: "metadata.all_keys",
            size: 10_000,
            order: { _key: "asc" },
          },
        },
        span_models: {
          nested: { path: "spans" },
          aggs: {
            models: {
              terms: {
                field: "spans.model",
                size: 10_000,
                order: { _key: "asc" },
              },
            },
          },
        },
      },
    }),
    // Fetch 10k traces but only span name/model/type fields (very lightweight)
    client.search<{ spans?: Array<{ name?: string; model?: string; type?: string }> }>({
      index: TRACE_INDEX.alias,
      size: 10000,
      _source: {
        includes: ["spans.name", "spans.model", "spans.type"],
      },
      query: { bool: { filter: [projectFilter, dateFilter] } },
      sort: [{ "timestamps.started_at": { order: "desc" } }],
    }),
  ]);

  // Extract metadata keys from aggregation
  const metadataKeyBuckets =
    (aggsResult.aggregations?.metadata_keys as any)?.buckets ?? [];
  const metadataKeys = metadataKeyBuckets.map((bucket: any) => ({
    key: bucket.key as string,
    label: bucket.key as string,
  }));

  // Extract span models from aggregation
  const spanModelBuckets =
    (aggsResult.aggregations?.span_models as any)?.models?.buckets ?? [];
  const modelNames = new Set<string>(
    spanModelBuckets.map((bucket: any) => bucket.key as string),
  );

  // Extract span names from the lightweight search results
  const spanNameSet = new Set<string>(modelNames);
  for (const hit of spansResult.hits.hits) {
    const spans = hit._source?.spans ?? [];
    for (const span of spans) {
      const name = span.name ?? (span.type === "llm" ? span.model : undefined);
      if (name) {
        spanNameSet.add(name);
      }
    }
  }

  const spanNames = Array.from(spanNameSet)
    .sort()
    .map((name) => ({ key: name, label: name }));

  return { spanNames, metadataKeys };
}
