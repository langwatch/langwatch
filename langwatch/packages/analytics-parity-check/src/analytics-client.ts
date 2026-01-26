/**
 * Client for querying analytics APIs
 */

import type {
  TimeseriesInput,
  DataForFilterInput,
  SharedFiltersInput,
  TimeseriesResult,
  FilterDataResult,
  TopDocumentsResult,
  FeedbacksResult,
} from "./types.js";

interface AnalyticsQueryResult {
  timeseries: TimeseriesResult | null;
  filterData: Record<string, FilterDataResult | null>;
  topDocuments: TopDocumentsResult | null;
  feedbacks: FeedbacksResult | null;
}

/**
 * Execute a tRPC query via HTTP POST
 * This is a simplified approach - in production you'd use the tRPC client
 */
async function executeTrpcQuery<T>(
  baseUrl: string,
  apiKey: string,
  procedure: string,
  input: unknown,
): Promise<T | null> {
  // Build the tRPC batch query URL
  const url = `${baseUrl}/api/trpc/${procedure}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": apiKey,
        // For tRPC, we typically need cookie-based auth
        // This may need adjustment based on actual auth mechanism
      },
      body: JSON.stringify({ json: input }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`tRPC query failed for ${procedure}: HTTP ${response.status} - ${text}`);
      return null;
    }

    const result = await response.json() as { result?: { data?: { json?: T } } };
    return result.result?.data?.json ?? null;
  } catch (error) {
    console.error(`tRPC query error for ${procedure}:`, error);
    return null;
  }
}

/**
 * Query timeseries analytics
 */
export async function queryTimeseries(
  baseUrl: string,
  apiKey: string,
  input: TimeseriesInput,
): Promise<TimeseriesResult | null> {
  return executeTrpcQuery<TimeseriesResult>(
    baseUrl,
    apiKey,
    "analytics.getTimeseries",
    input,
  );
}

/**
 * Query data for filter
 */
export async function queryDataForFilter(
  baseUrl: string,
  apiKey: string,
  input: DataForFilterInput,
): Promise<FilterDataResult | null> {
  return executeTrpcQuery<FilterDataResult>(
    baseUrl,
    apiKey,
    "analytics.dataForFilter",
    input,
  );
}

/**
 * Query top used documents
 */
export async function queryTopDocuments(
  baseUrl: string,
  apiKey: string,
  input: SharedFiltersInput,
): Promise<TopDocumentsResult | null> {
  return executeTrpcQuery<TopDocumentsResult>(
    baseUrl,
    apiKey,
    "analytics.topUsedDocuments",
    input,
  );
}

/**
 * Query feedbacks
 */
export async function queryFeedbacks(
  baseUrl: string,
  apiKey: string,
  input: SharedFiltersInput,
): Promise<FeedbacksResult | null> {
  return executeTrpcQuery<FeedbacksResult>(
    baseUrl,
    apiKey,
    "analytics.feedbacks",
    input,
  );
}

/**
 * Build standard timeseries queries to verify
 */
function buildTimeseriesQueries(
  projectId: string,
  startDate: number,
  endDate: number,
): TimeseriesInput[] {
  const baseInput = {
    projectId,
    startDate,
    endDate,
    filters: {},
    timeZone: "UTC",
  };

  return [
    // Trace count
    {
      ...baseInput,
      series: [
        {
          metric: "metadata.trace_id",
          aggregation: "cardinality",
        },
      ],
    },
    // User count
    {
      ...baseInput,
      series: [
        {
          metric: "metadata.user_id",
          aggregation: "cardinality",
        },
      ],
    },
    // Total cost sum
    {
      ...baseInput,
      series: [
        {
          metric: "performance.total_cost",
          aggregation: "sum",
        },
      ],
    },
    // Token counts
    {
      ...baseInput,
      series: [
        {
          metric: "performance.prompt_tokens",
          aggregation: "sum",
        },
        {
          metric: "performance.completion_tokens",
          aggregation: "sum",
        },
      ],
    },
    // Average completion time
    {
      ...baseInput,
      series: [
        {
          metric: "performance.completion_time",
          aggregation: "avg",
        },
      ],
    },
  ];
}

/**
 * Build filter queries to verify
 */
function buildFilterQueries(
  projectId: string,
  startDate: number,
  endDate: number,
): DataForFilterInput[] {
  const baseInput = {
    projectId,
    startDate,
    endDate,
    filters: {},
  };

  return [
    { ...baseInput, field: "metadata.user_id" },
    { ...baseInput, field: "metadata.thread_id" },
    { ...baseInput, field: "metadata.labels" },
    { ...baseInput, field: "spans.model" },
    { ...baseInput, field: "spans.type" },
  ];
}

/**
 * Query all analytics from a project
 */
export async function queryAllAnalytics(
  baseUrl: string,
  apiKey: string,
  projectId: string,
  startDate: number,
  endDate: number,
): Promise<AnalyticsQueryResult> {
  const sharedInput: SharedFiltersInput = {
    projectId,
    startDate,
    endDate,
    filters: {},
  };

  // Build queries
  const timeseriesQueries = buildTimeseriesQueries(projectId, startDate, endDate);
  const filterQueries = buildFilterQueries(projectId, startDate, endDate);

  // Execute timeseries queries
  console.log("  Querying timeseries...");
  let timeseries: TimeseriesResult | null = null;
  for (const query of timeseriesQueries) {
    const result = await queryTimeseries(baseUrl, apiKey, query);
    if (result) {
      // Merge results - for simplicity, just use the last successful result
      timeseries = result;
    }
  }

  // Execute filter queries
  console.log("  Querying filters...");
  const filterData: Record<string, FilterDataResult | null> = {};
  for (const query of filterQueries) {
    filterData[query.field] = await queryDataForFilter(baseUrl, apiKey, query);
  }

  // Query top documents
  console.log("  Querying top documents...");
  const topDocuments = await queryTopDocuments(baseUrl, apiKey, sharedInput);

  // Query feedbacks
  console.log("  Querying feedbacks...");
  const feedbacks = await queryFeedbacks(baseUrl, apiKey, sharedInput);

  return {
    timeseries,
    filterData,
    topDocuments,
    feedbacks,
  };
}

/**
 * Execute specific queries and return structured results for comparison
 */
export interface StructuredQueryResults {
  queries: {
    name: string;
    type: "timeseries" | "filter" | "documents" | "feedbacks";
    input: unknown;
    result: unknown;
  }[];
}

export async function executeStructuredQueries(
  baseUrl: string,
  apiKey: string,
  projectId: string,
  startDate: number,
  endDate: number,
): Promise<StructuredQueryResults> {
  const queries: StructuredQueryResults["queries"] = [];

  const sharedInput: SharedFiltersInput = {
    projectId,
    startDate,
    endDate,
    filters: {},
  };

  // Timeseries: Trace count
  const traceCountInput: TimeseriesInput = {
    ...sharedInput,
    series: [{ metric: "metadata.trace_id", aggregation: "cardinality" }],
    timeZone: "UTC",
  };
  queries.push({
    name: "timeseries_trace_count",
    type: "timeseries",
    input: traceCountInput,
    result: await queryTimeseries(baseUrl, apiKey, traceCountInput),
  });

  // Timeseries: Cost sum
  const costSumInput: TimeseriesInput = {
    ...sharedInput,
    series: [{ metric: "performance.total_cost", aggregation: "sum" }],
    timeZone: "UTC",
  };
  queries.push({
    name: "timeseries_cost_sum",
    type: "timeseries",
    input: costSumInput,
    result: await queryTimeseries(baseUrl, apiKey, costSumInput),
  });

  // Timeseries: Token counts
  const tokenCountInput: TimeseriesInput = {
    ...sharedInput,
    series: [
      { metric: "performance.prompt_tokens", aggregation: "sum" },
      { metric: "performance.completion_tokens", aggregation: "sum" },
    ],
    timeZone: "UTC",
  };
  queries.push({
    name: "timeseries_token_counts",
    type: "timeseries",
    input: tokenCountInput,
    result: await queryTimeseries(baseUrl, apiKey, tokenCountInput),
  });

  // Timeseries: Average completion time
  const avgTimeInput: TimeseriesInput = {
    ...sharedInput,
    series: [{ metric: "performance.completion_time", aggregation: "avg" }],
    timeZone: "UTC",
  };
  queries.push({
    name: "timeseries_avg_completion_time",
    type: "timeseries",
    input: avgTimeInput,
    result: await queryTimeseries(baseUrl, apiKey, avgTimeInput),
  });

  // Filter: User IDs
  const userFilterInput: DataForFilterInput = {
    ...sharedInput,
    field: "metadata.user_id",
  };
  queries.push({
    name: "filter_user_ids",
    type: "filter",
    input: userFilterInput,
    result: await queryDataForFilter(baseUrl, apiKey, userFilterInput),
  });

  // Filter: Thread IDs
  const threadFilterInput: DataForFilterInput = {
    ...sharedInput,
    field: "metadata.thread_id",
  };
  queries.push({
    name: "filter_thread_ids",
    type: "filter",
    input: threadFilterInput,
    result: await queryDataForFilter(baseUrl, apiKey, threadFilterInput),
  });

  // Filter: Labels
  const labelsFilterInput: DataForFilterInput = {
    ...sharedInput,
    field: "metadata.labels",
  };
  queries.push({
    name: "filter_labels",
    type: "filter",
    input: labelsFilterInput,
    result: await queryDataForFilter(baseUrl, apiKey, labelsFilterInput),
  });

  // Filter: Models
  const modelsFilterInput: DataForFilterInput = {
    ...sharedInput,
    field: "spans.model",
  };
  queries.push({
    name: "filter_models",
    type: "filter",
    input: modelsFilterInput,
    result: await queryDataForFilter(baseUrl, apiKey, modelsFilterInput),
  });

  // Filter: Span types
  const spanTypesFilterInput: DataForFilterInput = {
    ...sharedInput,
    field: "spans.type",
  };
  queries.push({
    name: "filter_span_types",
    type: "filter",
    input: spanTypesFilterInput,
    result: await queryDataForFilter(baseUrl, apiKey, spanTypesFilterInput),
  });

  // Top documents
  queries.push({
    name: "top_documents",
    type: "documents",
    input: sharedInput,
    result: await queryTopDocuments(baseUrl, apiKey, sharedInput),
  });

  // Feedbacks
  queries.push({
    name: "feedbacks",
    type: "feedbacks",
    input: sharedInput,
    result: await queryFeedbacks(baseUrl, apiKey, sharedInput),
  });

  return { queries };
}
