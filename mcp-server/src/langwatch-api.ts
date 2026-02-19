import { getConfig, requireApiKey } from "./config.js";

// --- Response types ---

export interface TraceSearchResult {
  trace_id: string;
  formatted_trace?: string;
  input?: { value: string };
  output?: { value: string };
  timestamps?: { started_at?: string | number };
  metadata?: Record<string, unknown>;
  error?: Record<string, unknown>;
}

export interface SearchTracesResponse {
  traces: TraceSearchResult[];
  pagination?: {
    totalHits?: number;
    scrollId?: string;
  };
}

export interface TraceDetailResponse {
  trace_id: string;
  formatted_trace?: string;
  input?: { value: string };
  output?: { value: string };
  timestamps?: {
    started_at?: string | number;
    updated_at?: string | number;
    inserted_at?: string | number;
  };
  metadata?: {
    user_id?: string;
    thread_id?: string;
    customer_id?: string;
    labels?: string[];
    [key: string]: unknown;
  };
  error?: Record<string, unknown>;
  ascii_tree?: string;
  evaluations?: Array<{
    evaluator_id?: string;
    name?: string;
    score?: number;
    passed?: boolean;
    label?: string;
  }>;
  spans?: Array<{
    span_id: string;
    name?: string;
    type?: string;
    model?: string;
    input?: { value: string };
    output?: { value: string };
    timestamps?: { started_at?: number; finished_at?: number };
    metrics?: {
      completion_time_ms?: number;
      prompt_tokens?: number;
      completion_tokens?: number;
      tokens_estimated?: boolean;
      cost?: number;
    };
  }>;
}

export interface AnalyticsBucket {
  date: string;
  [key: string]: unknown;
}

export interface AnalyticsTimeseriesResponse {
  currentPeriod: AnalyticsBucket[];
  previousPeriod: AnalyticsBucket[];
}

export interface PromptSummary {
  id?: string;
  handle?: string;
  name?: string;
  description?: string | null;
  latestVersionNumber?: number;
  version?: number;
}

export interface PromptVersion {
  version?: number;
  commitMessage?: string;
  model?: string;
  modelProvider?: string;
  messages?: Array<{ role: string; content: string }>;
}

export interface PromptDetailResponse extends PromptSummary {
  versions?: PromptVersion[];
  model?: string;
  modelProvider?: string;
  messages?: Array<{ role: string; content: string }>;
  prompt?: Array<{ role: string; content: string }>;
}

export interface PromptMutationResponse {
  id?: string;
  handle?: string;
  name?: string;
  latestVersionNumber?: number;
}

// --- HTTP client ---

/**
 * Sends an HTTP request to the LangWatch API.
 *
 * Builds the full URL from the configured endpoint, adds authentication,
 * and handles JSON serialization/deserialization.
 *
 * @throws Error with status code and response body when the response is not OK
 */
async function makeRequest(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown
): Promise<unknown> {
  const url = getConfig().endpoint + path;
  const headers: Record<string, string> = {
    "X-Auth-Token": requireApiKey(),
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(
      `LangWatch API error ${response.status}: ${responseBody}`
    );
  }

  return response.json();
}

/** Searches traces with optional filters and pagination. */
export async function searchTraces(params: {
  query?: string;
  filters?: Record<string, string[]>;
  startDate: number;
  endDate: number;
  pageSize?: number;
  pageOffset?: number;
  scrollId?: string;
  format?: "digest" | "json";
}): Promise<SearchTracesResponse> {
  const { format = "digest", ...rest } = params;
  return makeRequest("POST", "/api/traces/search", {
    ...rest,
    format,
  }) as Promise<SearchTracesResponse>;
}

/** Retrieves a single trace by its ID. */
export async function getTraceById(
  traceId: string,
  format: "digest" | "json" = "digest"
): Promise<TraceDetailResponse> {
  return makeRequest(
    "GET",
    `/api/traces/${encodeURIComponent(traceId)}?format=${format}`
  ) as Promise<TraceDetailResponse>;
}

/** Fetches analytics timeseries data for the given metrics and date range. */
export async function getAnalyticsTimeseries(params: {
  series: Array<{
    metric: string;
    aggregation: string;
    key?: string;
    subkey?: string;
  }>;
  startDate: number;
  endDate: number;
  timeZone?: string;
  groupBy?: string;
  groupByKey?: string;
  filters?: Record<string, string[]>;
}): Promise<AnalyticsTimeseriesResponse> {
  return makeRequest(
    "POST",
    "/api/analytics/timeseries",
    params
  ) as Promise<AnalyticsTimeseriesResponse>;
}

/** Lists all prompts in the project. */
export async function listPrompts(): Promise<PromptSummary[]> {
  return makeRequest("GET", "/api/prompts") as Promise<PromptSummary[]>;
}

/** Retrieves a single prompt by ID or handle. */
export async function getPrompt(
  idOrHandle: string,
  version?: number
): Promise<PromptDetailResponse> {
  const query = version != null ? `?version=${version}` : "";
  return makeRequest(
    "GET",
    `/api/prompts/${encodeURIComponent(idOrHandle)}${query}`
  ) as Promise<PromptDetailResponse>;
}

/** Creates a new prompt. */
export async function createPrompt(data: {
  name: string;
  handle?: string;
  messages: Array<{ role: string; content: string }>;
  model: string;
  modelProvider: string;
  description?: string;
}): Promise<PromptMutationResponse> {
  return makeRequest(
    "POST",
    "/api/prompts",
    data
  ) as Promise<PromptMutationResponse>;
}

/** Updates an existing prompt by ID or handle. */
export async function updatePrompt(
  idOrHandle: string,
  data: {
    messages?: Array<{ role: string; content: string }>;
    model?: string;
    modelProvider?: string;
    commitMessage?: string;
  }
): Promise<PromptMutationResponse> {
  return makeRequest(
    "POST",
    `/api/prompts/${encodeURIComponent(idOrHandle)}`,
    data
  ) as Promise<PromptMutationResponse>;
}

/** Creates a new version of an existing prompt. */
export async function createPromptVersion(
  idOrHandle: string,
  data: {
    messages?: Array<{ role: string; content: string }>;
    model?: string;
    modelProvider?: string;
    commitMessage?: string;
  }
): Promise<PromptMutationResponse> {
  return makeRequest(
    "POST",
    `/api/prompts/${encodeURIComponent(idOrHandle)}/versions`,
    data
  ) as Promise<PromptMutationResponse>;
}

// --- Scenario types ---

export interface ScenarioSummary {
  id: string;
  name: string;
  situation: string;
  criteria: string[];
  labels: string[];
}

export interface ScenarioArchiveResponse {
  id: string;
  archived: boolean;
}

// --- Scenario API functions ---

/** Lists all scenarios in the project. */
export async function listScenarios(): Promise<ScenarioSummary[]> {
  return makeRequest("GET", "/api/scenarios") as Promise<ScenarioSummary[]>;
}

/** Retrieves a single scenario by ID. */
export async function getScenario(id: string): Promise<ScenarioSummary> {
  return makeRequest(
    "GET",
    `/api/scenarios/${encodeURIComponent(id)}`
  ) as Promise<ScenarioSummary>;
}

/** Creates a new scenario. */
export async function createScenario(data: {
  name: string;
  situation?: string;
  criteria?: string[];
  labels?: string[];
}): Promise<ScenarioSummary> {
  return makeRequest("POST", "/api/scenarios", data) as Promise<ScenarioSummary>;
}

/** Updates an existing scenario. */
export async function updateScenario(
  id: string,
  data: {
    name?: string;
    situation?: string;
    criteria?: string[];
    labels?: string[];
  }
): Promise<ScenarioSummary> {
  return makeRequest(
    "PUT",
    `/api/scenarios/${encodeURIComponent(id)}`,
    data
  ) as Promise<ScenarioSummary>;
}

/** Archives (soft-deletes) a scenario. */
export async function archiveScenario(
  id: string
): Promise<ScenarioArchiveResponse> {
  return makeRequest(
    "DELETE",
    `/api/scenarios/${encodeURIComponent(id)}`
  ) as Promise<ScenarioArchiveResponse>;
}
