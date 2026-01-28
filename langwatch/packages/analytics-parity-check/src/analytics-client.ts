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
 * Result from tRPC query with error tracking
 */
interface TrpcQueryResult<T> {
  data: T | null;
  error: string | null;
}

/**
 * Execute a tRPC query via HTTP GET
 * This is a simplified approach - in production you'd use the tRPC client
 */
async function executeTrpcQuery<T>(
  baseUrl: string,
  apiKey: string,
  procedure: string,
  input: unknown,
): Promise<TrpcQueryResult<T>> {
  // Build the tRPC query URL with input as query parameter (queries use GET)
  const encodedInput = encodeURIComponent(JSON.stringify({ json: input }));
  const url = `${baseUrl}/api/trpc/${procedure}?input=${encodedInput}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Auth-Token": apiKey,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      const errorMsg = `HTTP ${response.status}: ${text.slice(0, 200)}`;
      console.error(`tRPC query failed for ${procedure}: ${errorMsg}`);
      return { data: null, error: errorMsg };
    }

    const result = await response.json() as { result?: { data?: { json?: T } } };
    return { data: result.result?.data?.json ?? null, error: null };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`tRPC query error for ${procedure}:`, errorMsg);
    return { data: null, error: errorMsg };
  }
}

/**
 * Query timeseries analytics via REST endpoint (supports API key auth)
 */
export async function queryTimeseries(
  baseUrl: string,
  apiKey: string,
  input: TimeseriesInput,
): Promise<TrpcQueryResult<TimeseriesResult>> {
  const url = `${baseUrl}/api/analytics`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": apiKey,
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const text = await response.text();
      const errorMsg = `HTTP ${response.status}: ${text.slice(0, 200)}`;
      console.error(`REST analytics query failed: ${errorMsg}`);
      return { data: null, error: errorMsg };
    }

    // REST endpoint returns the result directly (not wrapped like tRPC)
    const result = await response.json() as TimeseriesResult;
    return { data: result, error: null };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`REST analytics query error:`, errorMsg);
    return { data: null, error: errorMsg };
  }
}

/**
 * Query data for filter
 */
export async function queryDataForFilter(
  baseUrl: string,
  apiKey: string,
  input: DataForFilterInput,
): Promise<TrpcQueryResult<FilterDataResult>> {
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
): Promise<TrpcQueryResult<TopDocumentsResult>> {
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
): Promise<TrpcQueryResult<FeedbacksResult>> {
  return executeTrpcQuery<FeedbacksResult>(
    baseUrl,
    apiKey,
    "analytics.feedbacks",
    input,
  );
}

/**
 * Query trace count for a project - useful for polling ingestion status
 */
export async function queryTraceCount(
  baseUrl: string,
  apiKey: string,
  projectId: string,
  startDate: number,
  endDate: number,
): Promise<{ count: number; error: string | null }> {
  const input: TimeseriesInput = {
    projectId,
    startDate,
    endDate,
    filters: {},
    series: [{ metric: "metadata.trace_id", aggregation: "cardinality" }],
    timeZone: "UTC",
    timeScale: "full", // Single bucket for the entire period
  };

  const result = await queryTimeseries(baseUrl, apiKey, input);

  if (result.error) {
    return { count: 0, error: result.error };
  }

  if (!result.data?.currentPeriod?.[0]) {
    return { count: 0, error: null };
  }

  // Extract the count from the first (and only) bucket
  const bucket = result.data.currentPeriod[0];
  const countKey = Object.keys(bucket).find(k => k !== "date");
  const count = countKey ? Number(bucket[countKey]) || 0 : 0;

  return { count, error: null };
}

/**
 * Poll both ES and CH projects in parallel until expected trace count is reached
 */
export async function pollUntilTracesReady(
  baseUrl: string,
  esApiKey: string,
  esProjectId: string,
  chApiKey: string,
  chProjectId: string,
  expectedCount: number,
  startDate: number,
  endDate: number,
  maxWaitMs: number = 120000,
  pollIntervalMs: number = 2000,
): Promise<{ esReady: boolean; chReady: boolean; esCount: number; chCount: number; esError: string | null; chError: string | null }> {
  const startTime = Date.now();
  let esCount = 0;
  let chCount = 0;
  let esError: string | null = null;
  let chError: string | null = null;

  console.log(`  Polling for ${expectedCount} traces (timeout: ${maxWaitMs / 1000}s)...`);

  while (Date.now() - startTime < maxWaitMs) {
    // Query both projects in parallel
    const [esResult, chResult] = await Promise.all([
      queryTraceCount(baseUrl, esApiKey, esProjectId, startDate, endDate),
      queryTraceCount(baseUrl, chApiKey, chProjectId, startDate, endDate),
    ]);

    esCount = esResult.count;
    chCount = chResult.count;
    esError = esResult.error;
    chError = chResult.error;

    // Log progress
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    process.stdout.write(`\r  [${elapsed}s] ES: ${esCount}/${expectedCount}, CH: ${chCount}/${expectedCount}${esError ? " (ES error)" : ""}${chError ? " (CH error)" : ""}   `);

    // Check if both are ready
    const esReady = esCount >= expectedCount;
    const chReady = chCount >= expectedCount;

    if (esReady && chReady) {
      console.log(`\n  Both projects ready!`);
      return { esReady, chReady, esCount, chCount, esError, chError };
    }

    // If there are persistent errors, return early with failure
    if (esError && chError) {
      console.log(`\n  Both projects have errors, stopping poll`);
      return { esReady: false, chReady: false, esCount, chCount, esError, chError };
    }

    await sleep(pollIntervalMs);
  }

  // Timeout reached
  console.log(`\n  Timeout reached. ES: ${esCount}/${expectedCount}, CH: ${chCount}/${expectedCount}`);
  return {
    esReady: esCount >= expectedCount,
    chReady: chCount >= expectedCount,
    esCount,
    chCount,
    esError,
    chError,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    if (result.data) {
      // Merge results - for simplicity, just use the last successful result
      timeseries = result.data;
    }
  }

  // Execute filter queries
  console.log("  Querying filters...");
  const filterData: Record<string, FilterDataResult | null> = {};
  for (const query of filterQueries) {
    const result = await queryDataForFilter(baseUrl, apiKey, query);
    filterData[query.field] = result.data;
  }

  // Query top documents
  console.log("  Querying top documents...");
  const topDocsResult = await queryTopDocuments(baseUrl, apiKey, sharedInput);

  // Query feedbacks
  console.log("  Querying feedbacks...");
  const feedbacksResult = await queryFeedbacks(baseUrl, apiKey, sharedInput);

  return {
    timeseries,
    filterData,
    topDocuments: topDocsResult.data,
    feedbacks: feedbacksResult.data,
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
    error: string | null;
  }[];
  totalQueries: number;
  successfulQueries: number;
  failedQueries: number;
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

  // =====================================================
  // TIMESERIES QUERIES (via REST /api/analytics - supports API key auth)
  // =====================================================

  // Timeseries: Trace count
  const traceCountInput: TimeseriesInput = {
    ...sharedInput,
    series: [{ metric: "metadata.trace_id", aggregation: "cardinality" }],
    timeZone: "UTC",
  };
  const traceCountResult = await queryTimeseries(baseUrl, apiKey, traceCountInput);
  queries.push({
    name: "timeseries_trace_count",
    type: "timeseries",
    input: traceCountInput,
    result: traceCountResult.data,
    error: traceCountResult.error,
  });

  // Timeseries: User count
  const userCountInput: TimeseriesInput = {
    ...sharedInput,
    series: [{ metric: "metadata.user_id", aggregation: "cardinality" }],
    timeZone: "UTC",
  };
  const userCountResult = await queryTimeseries(baseUrl, apiKey, userCountInput);
  queries.push({
    name: "timeseries_user_count",
    type: "timeseries",
    input: userCountInput,
    result: userCountResult.data,
    error: userCountResult.error,
  });

  // Timeseries: Cost sum
  const costSumInput: TimeseriesInput = {
    ...sharedInput,
    series: [{ metric: "performance.total_cost", aggregation: "sum" }],
    timeZone: "UTC",
  };
  const costSumResult = await queryTimeseries(baseUrl, apiKey, costSumInput);
  queries.push({
    name: "timeseries_cost_sum",
    type: "timeseries",
    input: costSumInput,
    result: costSumResult.data,
    error: costSumResult.error,
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
  const tokenCountResult = await queryTimeseries(baseUrl, apiKey, tokenCountInput);
  queries.push({
    name: "timeseries_token_counts",
    type: "timeseries",
    input: tokenCountInput,
    result: tokenCountResult.data,
    error: tokenCountResult.error,
  });

  // Timeseries: Average completion time
  const avgTimeInput: TimeseriesInput = {
    ...sharedInput,
    series: [{ metric: "performance.completion_time", aggregation: "avg" }],
    timeZone: "UTC",
  };
  const avgTimeResult = await queryTimeseries(baseUrl, apiKey, avgTimeInput);
  queries.push({
    name: "timeseries_avg_completion_time",
    type: "timeseries",
    input: avgTimeInput,
    result: avgTimeResult.data,
    error: avgTimeResult.error,
  });

  // Timeseries: P99 completion time
  const p99TimeInput: TimeseriesInput = {
    ...sharedInput,
    series: [{ metric: "performance.completion_time", aggregation: "p99" }],
    timeZone: "UTC",
  };
  const p99TimeResult = await queryTimeseries(baseUrl, apiKey, p99TimeInput);
  queries.push({
    name: "timeseries_p99_completion_time",
    type: "timeseries",
    input: p99TimeInput,
    result: p99TimeResult.data,
    error: p99TimeResult.error,
  });

  // =====================================================
  // EXPANDED METRICS COVERAGE
  // =====================================================

  // Timeseries: Thread count
  const threadCountInput: TimeseriesInput = {
    ...sharedInput,
    series: [{ metric: "metadata.thread_id", aggregation: "cardinality" }],
    timeZone: "UTC",
  };
  const threadCountResult = await queryTimeseries(baseUrl, apiKey, threadCountInput);
  queries.push({
    name: "timeseries_thread_count",
    type: "timeseries",
    input: threadCountInput,
    result: threadCountResult.data,
    error: threadCountResult.error,
  });

  // Timeseries: First token time (avg)
  const firstTokenAvgInput: TimeseriesInput = {
    ...sharedInput,
    series: [{ metric: "performance.first_token", aggregation: "avg" }],
    timeZone: "UTC",
  };
  const firstTokenAvgResult = await queryTimeseries(baseUrl, apiKey, firstTokenAvgInput);
  queries.push({
    name: "timeseries_first_token_avg",
    type: "timeseries",
    input: firstTokenAvgInput,
    result: firstTokenAvgResult.data,
    error: firstTokenAvgResult.error,
  });

  // Timeseries: First token time (p99)
  const firstTokenP99Input: TimeseriesInput = {
    ...sharedInput,
    series: [{ metric: "performance.first_token", aggregation: "p99" }],
    timeZone: "UTC",
  };
  const firstTokenP99Result = await queryTimeseries(baseUrl, apiKey, firstTokenP99Input);
  queries.push({
    name: "timeseries_first_token_p99",
    type: "timeseries",
    input: firstTokenP99Input,
    result: firstTokenP99Result.data,
    error: firstTokenP99Result.error,
  });

  // Timeseries: Median completion time
  const medianTimeInput: TimeseriesInput = {
    ...sharedInput,
    series: [{ metric: "performance.completion_time", aggregation: "median" }],
    timeZone: "UTC",
  };
  const medianTimeResult = await queryTimeseries(baseUrl, apiKey, medianTimeInput);
  queries.push({
    name: "timeseries_median_completion_time",
    type: "timeseries",
    input: medianTimeInput,
    result: medianTimeResult.data,
    error: medianTimeResult.error,
  });

  // Timeseries: P90 completion time
  const p90TimeInput: TimeseriesInput = {
    ...sharedInput,
    series: [{ metric: "performance.completion_time", aggregation: "p90" }],
    timeZone: "UTC",
  };
  const p90TimeResult = await queryTimeseries(baseUrl, apiKey, p90TimeInput);
  queries.push({
    name: "timeseries_p90_completion_time",
    type: "timeseries",
    input: p90TimeInput,
    result: p90TimeResult.data,
    error: p90TimeResult.error,
  });

  // Timeseries: P95 completion time
  const p95TimeInput: TimeseriesInput = {
    ...sharedInput,
    series: [{ metric: "performance.completion_time", aggregation: "p95" }],
    timeZone: "UTC",
  };
  const p95TimeResult = await queryTimeseries(baseUrl, apiKey, p95TimeInput);
  queries.push({
    name: "timeseries_p95_completion_time",
    type: "timeseries",
    input: p95TimeInput,
    result: p95TimeResult.data,
    error: p95TimeResult.error,
  });

  // Timeseries: Min completion time
  const minTimeInput: TimeseriesInput = {
    ...sharedInput,
    series: [{ metric: "performance.completion_time", aggregation: "min" }],
    timeZone: "UTC",
  };
  const minTimeResult = await queryTimeseries(baseUrl, apiKey, minTimeInput);
  queries.push({
    name: "timeseries_min_completion_time",
    type: "timeseries",
    input: minTimeInput,
    result: minTimeResult.data,
    error: minTimeResult.error,
  });

  // Timeseries: Max completion time
  const maxTimeInput: TimeseriesInput = {
    ...sharedInput,
    series: [{ metric: "performance.completion_time", aggregation: "max" }],
    timeZone: "UTC",
  };
  const maxTimeResult = await queryTimeseries(baseUrl, apiKey, maxTimeInput);
  queries.push({
    name: "timeseries_max_completion_time",
    type: "timeseries",
    input: maxTimeInput,
    result: maxTimeResult.data,
    error: maxTimeResult.error,
  });

  // Timeseries: Total tokens sum
  const totalTokensInput: TimeseriesInput = {
    ...sharedInput,
    series: [{ metric: "performance.total_tokens", aggregation: "sum" }],
    timeZone: "UTC",
  };
  const totalTokensResult = await queryTimeseries(baseUrl, apiKey, totalTokensInput);
  queries.push({
    name: "timeseries_total_tokens",
    type: "timeseries",
    input: totalTokensInput,
    result: totalTokensResult.data,
    error: totalTokensResult.error,
  });

  // Timeseries: Tokens per second avg
  const tokensPerSecondInput: TimeseriesInput = {
    ...sharedInput,
    series: [{ metric: "performance.tokens_per_second", aggregation: "avg" }],
    timeZone: "UTC",
  };
  const tokensPerSecondResult = await queryTimeseries(baseUrl, apiKey, tokensPerSecondInput);
  queries.push({
    name: "timeseries_tokens_per_second",
    type: "timeseries",
    input: tokensPerSecondInput,
    result: tokensPerSecondResult.data,
    error: tokensPerSecondResult.error,
  });

  // =====================================================
  // GROUPING QUERIES
  // =====================================================

  // Group by user_id with trace count
  const groupByUserInput: TimeseriesInput = {
    ...sharedInput,
    series: [{ metric: "metadata.trace_id", aggregation: "cardinality" }],
    groupBy: "metadata.user_id",
    timeZone: "UTC",
  };
  const groupByUserResult = await queryTimeseries(baseUrl, apiKey, groupByUserInput);
  queries.push({
    name: "grouped_by_user_trace_count",
    type: "timeseries",
    input: groupByUserInput,
    result: groupByUserResult.data,
    error: groupByUserResult.error,
  });

  // Group by model with token counts
  const groupByModelInput: TimeseriesInput = {
    ...sharedInput,
    series: [
      { metric: "performance.prompt_tokens", aggregation: "sum" },
      { metric: "performance.completion_tokens", aggregation: "sum" },
    ],
    groupBy: "spans.model",
    timeZone: "UTC",
  };
  const groupByModelResult = await queryTimeseries(baseUrl, apiKey, groupByModelInput);
  queries.push({
    name: "grouped_by_model_tokens",
    type: "timeseries",
    input: groupByModelInput,
    result: groupByModelResult.data,
    error: groupByModelResult.error,
  });

  // Group by labels with cost sum
  const groupByLabelsInput: TimeseriesInput = {
    ...sharedInput,
    series: [{ metric: "performance.total_cost", aggregation: "sum" }],
    groupBy: "metadata.labels",
    timeZone: "UTC",
  };
  const groupByLabelsResult = await queryTimeseries(baseUrl, apiKey, groupByLabelsInput);
  queries.push({
    name: "grouped_by_labels_cost",
    type: "timeseries",
    input: groupByLabelsInput,
    result: groupByLabelsResult.data,
    error: groupByLabelsResult.error,
  });

  // Group by span type with count
  const groupBySpanTypeInput: TimeseriesInput = {
    ...sharedInput,
    series: [{ metric: "metadata.trace_id", aggregation: "cardinality" }],
    groupBy: "spans.type",
    timeZone: "UTC",
  };
  const groupBySpanTypeResult = await queryTimeseries(baseUrl, apiKey, groupBySpanTypeInput);
  queries.push({
    name: "grouped_by_span_type",
    type: "timeseries",
    input: groupBySpanTypeInput,
    result: groupBySpanTypeResult.data,
    error: groupBySpanTypeResult.error,
  });

  // =====================================================
  // FILTER QUERIES
  // =====================================================

  // Filter by span type = LLM
  const filterByLLMInput: TimeseriesInput = {
    projectId,
    startDate,
    endDate,
    filters: { "spans.type": ["llm"] },
    series: [
      { metric: "metadata.trace_id", aggregation: "cardinality" },
      { metric: "performance.total_cost", aggregation: "sum" },
    ],
    timeZone: "UTC",
  };
  const filterByLLMResult = await queryTimeseries(baseUrl, apiKey, filterByLLMInput);
  queries.push({
    name: "filtered_by_llm_span_type",
    type: "timeseries",
    input: filterByLLMInput,
    result: filterByLLMResult.data,
    error: filterByLLMResult.error,
  });

  // Filter by label = production
  const filterByLabelInput: TimeseriesInput = {
    projectId,
    startDate,
    endDate,
    filters: { "metadata.labels": ["production"] },
    series: [
      { metric: "metadata.trace_id", aggregation: "cardinality" },
      { metric: "performance.prompt_tokens", aggregation: "sum" },
    ],
    timeZone: "UTC",
  };
  const filterByLabelResult = await queryTimeseries(baseUrl, apiKey, filterByLabelInput);
  queries.push({
    name: "filtered_by_production_label",
    type: "timeseries",
    input: filterByLabelInput,
    result: filterByLabelResult.data,
    error: filterByLabelResult.error,
  });

  // Filter by error = true
  const filterByErrorInput: TimeseriesInput = {
    projectId,
    startDate,
    endDate,
    filters: { "traces.error": ["true"] },
    series: [{ metric: "metadata.trace_id", aggregation: "cardinality" }],
    timeZone: "UTC",
  };
  const filterByErrorResult = await queryTimeseries(baseUrl, apiKey, filterByErrorInput);
  queries.push({
    name: "filtered_by_error",
    type: "timeseries",
    input: filterByErrorInput,
    result: filterByErrorResult.data,
    error: filterByErrorResult.error,
  });

  // Filter by RAG span type
  const filterByRAGInput: TimeseriesInput = {
    projectId,
    startDate,
    endDate,
    filters: { "spans.type": ["rag"] },
    series: [{ metric: "metadata.trace_id", aggregation: "cardinality" }],
    timeZone: "UTC",
  };
  const filterByRAGResult = await queryTimeseries(baseUrl, apiKey, filterByRAGInput);
  queries.push({
    name: "filtered_by_rag_span_type",
    type: "timeseries",
    input: filterByRAGInput,
    result: filterByRAGResult.data,
    error: filterByRAGResult.error,
  });

  // Filter by specific model
  const filterByModelInput: TimeseriesInput = {
    projectId,
    startDate,
    endDate,
    filters: { "spans.model": ["gpt-4"] },
    series: [
      { metric: "metadata.trace_id", aggregation: "cardinality" },
      { metric: "performance.completion_time", aggregation: "avg" },
    ],
    timeZone: "UTC",
  };
  const filterByModelResult = await queryTimeseries(baseUrl, apiKey, filterByModelInput);
  queries.push({
    name: "filtered_by_gpt4_model",
    type: "timeseries",
    input: filterByModelInput,
    result: filterByModelResult.data,
    error: filterByModelResult.error,
  });

  // NOTE: Filter, Document, and Feedback queries require session auth (tRPC)
  // and are not accessible via API key. Skipping them for API-key based parity check.
  // The timeseries queries cover the core analytics aggregation logic.

  const totalQueries = queries.length;
  const failedQueries = queries.filter(q => q.error !== null).length;
  const successfulQueries = totalQueries - failedQueries;

  return { queries, totalQueries, successfulQueries, failedQueries };
}
