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
}: {
  operation: "query" | "insert";
  durationMs: number;
  params: unknown;
}): void {
  try {
    const meta = safeQueryMeta(params);

    queryLogger.debug(
      {
        source: "clickhouse",
        operation,
        durationMs: Math.round(durationMs),
        queryId: meta.queryId,
      },
      `ClickHouse ${operation} succeeded`
    );
  } catch (loggingError) {
    logger.error({ loggingError }, "Failed to log ClickHouse query success");
  }
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
    const start = performance.now();
    try {
      const result = await client.query(params);
      const durationMs = performance.now() - start;
      logSuccess({ operation: "query", durationMs, params });
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
