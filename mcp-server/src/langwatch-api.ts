import { getConfig, requireApiKey } from "./config.js";

/**
 * Sends an HTTP request to the LangWatch API.
 *
 * Builds the full URL from the configured endpoint, adds authentication,
 * and handles JSON serialization/deserialization.
 *
 * @throws Error with status code and response body when the response is not OK
 */
async function makeRequest(
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<unknown> {
  const url = getConfig().endpoint + path;
  const headers: Record<string, string> = {
    "X-Auth-Token": requireApiKey(),
  };

  if (method === "POST") {
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
}): Promise<unknown> {
  return makeRequest("POST", "/api/traces/search", {
    ...params,
    llmMode: true,
  });
}

/** Retrieves a single trace by its ID. */
export async function getTraceById(traceId: string): Promise<unknown> {
  return makeRequest("GET", `/api/traces/${traceId}?llmMode=true`);
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
}): Promise<unknown> {
  return makeRequest("POST", "/api/analytics/timeseries", params);
}

/** Lists all prompts in the project. */
export async function listPrompts(): Promise<unknown> {
  return makeRequest("GET", "/api/prompts");
}

/** Retrieves a single prompt by ID or handle. */
export async function getPrompt(idOrHandle: string): Promise<unknown> {
  return makeRequest(
    "GET",
    `/api/prompts/${encodeURIComponent(idOrHandle)}`
  );
}

/** Creates a new prompt. */
export async function createPrompt(data: {
  name: string;
  handle?: string;
  messages: Array<{ role: string; content: string }>;
  model: string;
  modelProvider: string;
  description?: string;
}): Promise<unknown> {
  return makeRequest("POST", "/api/prompts", data);
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
): Promise<unknown> {
  return makeRequest(
    "POST",
    `/api/prompts/${encodeURIComponent(idOrHandle)}`,
    data
  );
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
): Promise<unknown> {
  return makeRequest(
    "POST",
    `/api/prompts/${encodeURIComponent(idOrHandle)}/versions`,
    data
  );
}
