import type {
  HandledErrorFault,
  SerializedReason,
} from "@langwatch/handled-error";
import { getConfig, requireApiKey } from "./config.js";
import type { EvaluationSummary } from "./utils/format-evaluations.js";

// --- Response types ---

export interface TraceSearchResult {
  trace_id: string;
  formatted_trace?: string;
  input?: { value: string };
  output?: { value: string };
  timestamps?: { started_at?: string | number };
  metadata?: Record<string, unknown>;
  error?: Record<string, unknown>;
  evaluations?: EvaluationSummary[];
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
  evaluations?: EvaluationSummary[];
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
  latestVersionNumber?: number;
  version?: number;
}

export interface PromptVersion {
  version?: number;
  commitMessage?: string;
  model?: string;
  messages?: Array<{ role: string; content: string }>;
}

export interface PromptDetailResponse extends PromptSummary {
  versions?: PromptVersion[];
  model?: string;
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

export class LangWatchApiError extends Error {
  readonly code?: string;
  readonly tips?: string[];
  readonly docsUrl?: string;
  readonly fault?: HandledErrorFault;
  /**
   * The per-field failures behind this error, verbatim from the envelope.
   * A validation failure carries the offending field and the values it would
   * have accepted here — the difference between an agent correcting its own
   * request and an agent guessing again.
   */
  readonly reasons?: SerializedReason[];

  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody: string,
    options: {
      code?: string;
      tips?: string[];
      docsUrl?: string;
      fault?: HandledErrorFault;
      reasons?: SerializedReason[];
    } = {},
  ) {
    super(message);
    this.name = "LangWatchApiError";
    this.code = options.code;
    this.tips = options.tips;
    this.docsUrl = options.docsUrl;
    this.fault = options.fault;
    this.reasons = options.reasons;
  }
}

/** Structured fields extracted from a handled-error JSON response body. */
interface ParsedErrorBody {
  code?: string;
  message?: string;
  tips?: string[];
  docsUrl?: string;
  fault?: HandledErrorFault;
  reasons?: SerializedReason[];
}

const VALID_FAULTS: readonly HandledErrorFault[] = ["customer", "platform", "provider"];

/**
 * Parses an error response body as a handled-error envelope. Accepts both the
 * REST shape (`{ error: "<code>", message, tips?, docsUrl?, fault? }`) and the
 * serialized tRPC shape (`{ code, message?, tips?, docsUrl?, fault?, ... }`).
 * Returns an empty object when the body is not a recognizable error envelope.
 */
function parseErrorBody(responseBody: string): ParsedErrorBody {
  try {
    const parsed: unknown = JSON.parse(responseBody);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const body = parsed as Record<string, unknown>;
    // Prefer `code` (the domain discriminant) over `error` — the
    // packages/api unversioned envelope uses `error` for the HTTP status
    // text ("Not Found") while `code` holds the real code.
    const code =
      typeof body.code === "string"
        ? body.code
        : typeof body.error === "string"
          ? body.error
          : undefined;
    const message = typeof body.message === "string" ? body.message : undefined;
    if (code === undefined && message === undefined) {
      return {};
    }
    const tips =
      Array.isArray(body.tips) && body.tips.every((t) => typeof t === "string")
        ? (body.tips as string[])
        : undefined;
    const docsUrl = typeof body.docsUrl === "string" ? body.docsUrl : undefined;
    const fault = VALID_FAULTS.includes(body.fault as HandledErrorFault)
      ? (body.fault as HandledErrorFault)
      : undefined;
    const reasons =
      Array.isArray(body.reasons) &&
      body.reasons.every((r) => !!r && typeof r === "object")
        ? (body.reasons as SerializedReason[])
        : undefined;
    return { code, message, tips, docsUrl, fault, reasons };
  } catch {
    return {};
  }
}

/**
 * The human line for one per-field failure: the field, what it would have
 * accepted, and what it got. Returns null when a reason names no field, so a
 * generic nested error adds no noise to the message.
 *
 * This exists because the MCP transport's only channel to the caller is the
 * error MESSAGE — an agent never sees the `reasons` array itself, so a
 * rejection whose remedy lives only there is unfollowable.
 */
function describeReason(reason: SerializedReason): string | null {
  const meta = reason.meta;
  if (!meta || typeof meta !== "object") return null;

  const field = typeof meta.field === "string" ? meta.field : null;
  if (!field) return null;

  const parts = [`- ${field}`];
  if (meta.received !== undefined) {
    parts.push(`received ${JSON.stringify(meta.received)}`);
  }
  if (Array.isArray(meta.expected) && meta.expected.length > 0) {
    parts.push(`expected one of: ${meta.expected.join(", ")}`);
  }
  return parts.join(" — ");
}

/**
 * Sends an HTTP request to the LangWatch API.
 *
 * Builds the full URL from the configured endpoint, adds authentication,
 * and handles JSON serialization/deserialization.
 *
 * @throws LangWatchApiError with status code and response body when the
 * response is not OK.
 */
export async function makeRequest(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown
): Promise<unknown> {
  const config = getConfig();
  const url = config.endpoint + path;
  const headers: Record<string, string> = {
    "X-Auth-Token": requireApiKey(),
  };
  if (config.projectId) {
    headers["X-Project-Id"] = config.projectId;
  }

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
    const parsed = parseErrorBody(responseBody);
    const lines = [
      `LangWatch API error ${response.status}: ${parsed.message ?? responseBody}`,
    ];
    const reasonLines = (parsed.reasons ?? [])
      .map(describeReason)
      .filter((line): line is string => line !== null);
    if (reasonLines.length > 0) {
      lines.push("Rejected fields:", ...reasonLines);
    }
    if (parsed.tips && parsed.tips.length > 0) {
      lines.push("Tips:", ...parsed.tips.map((tip) => `- ${tip}`));
    }
    if (parsed.docsUrl) {
      lines.push(`Docs: ${parsed.docsUrl}`);
    }
    throw new LangWatchApiError(
      lines.join("\n"),
      response.status,
      responseBody,
      {
        code: parsed.code,
        tips: parsed.tips,
        docsUrl: parsed.docsUrl,
        fault: parsed.fault,
        reasons: parsed.reasons,
      },
    );
  }

  if (response.status === 204 || response.headers?.get("content-length") === "0") {
    return null;
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
  options?: { version?: number; tag?: string }
): Promise<PromptDetailResponse> {
  const params = new URLSearchParams();
  if (options?.version != null) params.set("version", String(options.version));
  if (options?.tag) params.set("tag", options.tag);
  const query = params.toString() ? `?${params}` : "";
  return makeRequest(
    "GET",
    `/api/prompts/${encodeURIComponent(idOrHandle)}${query}`
  ) as Promise<PromptDetailResponse>;
}

/** Creates a new prompt. */
export async function createPrompt(data: {
  handle: string;
  messages: Array<{ role: string; content: string }>;
  model: string;
  tags?: string[];
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
    commitMessage: string;
    tags?: string[];
  }
): Promise<PromptMutationResponse> {
  return makeRequest(
    "PUT",
    `/api/prompts/${encodeURIComponent(idOrHandle)}`,
    data
  ) as Promise<PromptMutationResponse>;
}

/** Assigns a tag to a specific prompt version. */
export async function assignPromptTag({
  idOrHandle,
  tag,
  versionId,
}: {
  idOrHandle: string;
  tag: string;
  versionId: string;
}): Promise<unknown> {
  return makeRequest(
    "PUT",
    `/api/prompts/${encodeURIComponent(idOrHandle)}/tags/${encodeURIComponent(tag)}`,
    { versionId }
  );
}

/** Lists all prompt tag definitions for the organization. */
export async function listPromptTags(): Promise<unknown> {
  return makeRequest("GET", "/api/prompts/tags");
}

/** Creates a custom prompt tag definition. */
export async function createPromptTag(name: string): Promise<unknown> {
  return makeRequest("POST", "/api/prompts/tags", { name });
}

/** Renames an existing prompt tag. */
export async function renamePromptTag({
  tag,
  name,
}: {
  tag: string;
  name: string;
}): Promise<unknown> {
  return makeRequest(
    "PUT",
    `/api/prompts/tags/${encodeURIComponent(tag)}`,
    { name }
  );
}

/** Deletes a prompt tag and all its assignments. */
export async function deletePromptTag(tag: string): Promise<unknown> {
  return makeRequest(
    "DELETE",
    `/api/prompts/tags/${encodeURIComponent(tag)}`
  );
}
