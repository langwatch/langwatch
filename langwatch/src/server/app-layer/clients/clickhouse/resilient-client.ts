import type { ClickHouseClient } from "@clickhouse/client";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:clickhouse:resilient");
const queryLogger = createLogger("langwatch:clickhouse:query");

const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message;
  if (message.includes("MEMORY_LIMIT_EXCEEDED")) return true;
  if (/timeout/i.test(message)) return true;

  const code = (error as NodeJS.ErrnoException).code;
  if (code && TRANSIENT_NETWORK_CODES.has(code)) return true;

  const status =
    (error as { statusCode?: number }).statusCode ??
    (error as { status?: number }).status;
  if (status === 429 || status === 502 || status === 503) return true;

  return false;
}

function jitteredBackoff({
  attempt,
  baseDelayMs,
  maxDelayMs,
}: {
  attempt: number;
  baseDelayMs: number;
  maxDelayMs: number;
}): number {
  const exponential = baseDelayMs * 2 ** attempt;
  const jitter = Math.random() * baseDelayMs;
  return Math.min(exponential + jitter, maxDelayMs);
}

function safeQueryMeta(params: unknown): {
  queryId?: string;
  format?: string;
  paramKeys?: string[];
  table?: string;
} {
  if (!params || typeof params !== "object") return {};
  const p = params as Record<string, unknown>;
  const meta: {
    queryId?: string;
    format?: string;
    paramKeys?: string[];
    table?: string;
  } = {};

  if (typeof p.query_id === "string") meta.queryId = p.query_id;
  if (typeof p.format === "string") meta.format = p.format;
  if (typeof p.table === "string") meta.table = p.table;
  if (p.query_params && typeof p.query_params === "object") {
    meta.paramKeys = Object.keys(p.query_params as Record<string, unknown>);
  }

  return meta;
}

/** Default threshold for slow query warnings. */
const DEFAULT_SLOW_QUERY_MS = 1000;
const DEFAULT_MAX_READ_BYTES = 3 * 1024 * 1024; // 3MB

/**
 * Per-query performance expectations, passed via `clickhouse_settings`.
 * The resilient client reads and strips these before forwarding to ClickHouse.
 *
 * Usage in repositories:
 * ```ts
 * client.query({
 *   query: "SELECT ...",
 *   clickhouse_settings: {
 *     langwatch_expected_max_duration_ms: 5000,    // allow up to 5s
 *     langwatch_expected_max_read_bytes: 5000000, // allow up to 5MB response
 *   },
 * });
 * ```
 */
const LANGWATCH_SETTING_KEYS = [
  "langwatch_expected_max_duration_ms",
  "langwatch_expected_max_read_bytes",
] as const;

interface QueryExpectations {
  maxDurationMs: number;
  maxReadBytes?: number;
}

const DEFAULT_EXPECTATIONS: QueryExpectations = {
  maxDurationMs: DEFAULT_SLOW_QUERY_MS,
  maxReadBytes: DEFAULT_MAX_READ_BYTES,
};

function extractExpectations(params: unknown): QueryExpectations {
  if (!params || typeof params !== "object") return DEFAULT_EXPECTATIONS;
  const settings = (params as Record<string, unknown>).clickhouse_settings;
  if (!settings || typeof settings !== "object") return DEFAULT_EXPECTATIONS;

  const s = settings as Record<string, unknown>;
  return {
    maxDurationMs: typeof s.langwatch_expected_max_duration_ms === "number"
      ? s.langwatch_expected_max_duration_ms
      : DEFAULT_SLOW_QUERY_MS,
    maxReadBytes: typeof s.langwatch_expected_max_read_bytes === "number"
      ? s.langwatch_expected_max_read_bytes
      : DEFAULT_MAX_READ_BYTES,
  };
}

/** Remove langwatch_* keys from clickhouse_settings before forwarding to ClickHouse. */
function stripLangwatchSettings(params: Record<string, unknown>): Record<string, unknown> {
  const settings = params.clickhouse_settings;
  if (!settings || typeof settings !== "object") return params;

  const s = settings as Record<string, unknown>;
  const hasLangwatchKeys = LANGWATCH_SETTING_KEYS.some((k) => k in s);
  if (!hasLangwatchKeys) return params;

  const cleaned = { ...s };
  for (const key of LANGWATCH_SETTING_KEYS) {
    delete cleaned[key];
  }
  return { ...params, clickhouse_settings: cleaned };
}

/**
 * Extracts read_bytes from the X-ClickHouse-Summary response header.
 * This measures how many bytes ClickHouse read from disk to answer the query —
 * a proxy for query weight. Available in all ClickHouse versions.
 * (read_bytes is always 0 for streaming formats like JSONEachRow.)
 */
function extractReadBytes(result: unknown): number | undefined {
  try {
    const headers = (result as { response_headers?: Record<string, string | string[] | undefined> })?.response_headers;
    const summary = headers?.["x-clickhouse-summary"];
    if (typeof summary !== "string") return undefined;
    const parsed = JSON.parse(summary) as { read_bytes?: string };
    return parsed.read_bytes ? Number(parsed.read_bytes) : undefined;
  } catch {
    return undefined;
  }
}

function extractQueryPreview(params: unknown): string | undefined {
  if (!params || typeof params !== "object") return undefined;
  const p = params as Record<string, unknown>;
  if (typeof p.query !== "string") return undefined;
  return p.query.length > 200 ? p.query.slice(0, 200) + "..." : p.query;
}

function logFailure({
  operation,
  error,
  durationMs,
  params,
}: {
  operation: "query" | "insert";
  error: unknown;
  durationMs: number;
  params: unknown;
}): void {
  try {
    const meta = safeQueryMeta(params);

    queryLogger.error(
      {
        source: "clickhouse",
        operation,
        durationMs: Math.round(durationMs),
        queryId: meta.queryId,
        format: meta.format,
        paramKeys: meta.paramKeys,
        error,
      },
      `ClickHouse ${operation} failed`
    );
  } catch (loggingError) {
    logger.error({ loggingError }, "Failed to log ClickHouse query failure");
  }
}

function logSuccess({
  operation,
  durationMs,
  params,
  readBytes,
}: {
  operation: "query" | "insert";
  durationMs: number;
  params: unknown;
  readBytes?: number;
}): void {
  try {
    const roundedMs = Math.round(durationMs);
    const meta = safeQueryMeta(params);
    const expectations = extractExpectations(params);

    const isSlow = roundedMs >= expectations.maxDurationMs;
    const isTooHeavy = expectations.maxReadBytes !== undefined
      && readBytes !== undefined
      && readBytes > expectations.maxReadBytes;

    if (isSlow || isTooHeavy) {
      const reasons: string[] = [];
      if (isSlow) reasons.push(`${roundedMs}ms > ${expectations.maxDurationMs}ms`);
      if (isTooHeavy) reasons.push(`${formatBytes(readBytes!)} > ${formatBytes(expectations.maxReadBytes!)} expected`);

      queryLogger.warn(
        {
          source: "clickhouse",
          operation,
          durationMs: roundedMs,
          readBytes,
          expectedMaxDurationMs: expectations.maxDurationMs,
          expectedMaxReadBytes: expectations.maxReadBytes,
          queryId: meta.queryId,
          table: meta.table,
          paramKeys: meta.paramKeys,
          query: extractQueryPreview(params),
        },
        `ClickHouse slow ${operation}: ${reasons.join(", ")}`
      );
    } else {
      queryLogger.debug(
        {
          source: "clickhouse",
          operation,
          durationMs: roundedMs,
          queryId: meta.queryId,
        },
        `ClickHouse ${operation} succeeded`
      );
    }
  } catch (loggingError) {
    logger.error({ loggingError }, "Failed to log ClickHouse query success");
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Wraps a ClickHouseClient with structured logging and insert retry.
 */
export function createResilientClickHouseClient({
  client,
  maxRetries = 3,
  baseDelayMs = 500,
  maxDelayMs = 10_000,
}: {
  client: ClickHouseClient;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}): ClickHouseClient {
  const wrapper = Object.create(client) as ClickHouseClient;

  wrapper.query = async (params) => {
    const cleanedParams = stripLangwatchSettings(params as Record<string, unknown>);
    const start = performance.now();
    try {
      const result = await client.query(cleanedParams as Parameters<typeof client.query>[0]);
      const durationMs = performance.now() - start;
      const readBytes = extractReadBytes(result);
      // params (not cleanedParams) so extractExpectations can read langwatch_* keys
      logSuccess({ operation: "query", durationMs, params, readBytes });
      return result;
    } catch (error) {
      const durationMs = performance.now() - start;
      logFailure({ operation: "query", error, durationMs, params });
      throw error;
    }
  };

  wrapper.insert = async (params) => {
    const start = performance.now();
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await client.insert(params);
        const durationMs = performance.now() - start;
        logSuccess({ operation: "insert", durationMs, params });
        return result;
      } catch (error) {
        lastError = error;

        if (!isTransientError(error) || attempt === maxRetries) {
          const durationMs = performance.now() - start;
          logFailure({ operation: "insert", error, durationMs, params });
          throw error;
        }

        const delay = jitteredBackoff({ attempt, baseDelayMs, maxDelayMs });

        try {
          logger.warn(
            {
              source: "clickhouse",
              operation: "insert",
              attempt: attempt + 1,
              maxRetries,
              delayMs: Math.round(delay),
              error,
            },
            "Transient ClickHouse insert error, retrying"
          );
        } catch (loggingError) {
          logger.error(
            { loggingError },
            "Failed to log transient insert retry"
          );
        }

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  };

  return wrapper;
}
