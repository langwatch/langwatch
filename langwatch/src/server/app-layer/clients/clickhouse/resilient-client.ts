import type { ClickHouseClient } from "@clickhouse/client";
import { createLogger } from "~/utils/logger/server";
import {
  observeClickHouseQueryDuration,
  incrementClickHouseQueryCount,
} from "~/server/clickhouse/metrics";
import {
  classifyClickHouseError,
  isTransientClickHouseError,
} from "./error-classification";
import { FailureRateMonitor } from "./failure-monitor";

const logger = createLogger("langwatch:clickhouse:resilient");
const queryLogger = createLogger("langwatch:clickhouse:query");

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

function logQueryFailure({
  operation,
  error,
  durationMs,
  params,
  failureMonitor,
}: {
  operation: "query" | "insert";
  error: unknown;
  durationMs: number;
  params: unknown;
  failureMonitor: FailureRateMonitor;
}): void {
  try {
    const errorType = classifyClickHouseError(error);
    const meta = safeQueryMeta(params);

    queryLogger.error(
      {
        source: "clickhouse",
        operation,
        errorType,
        durationMs: Math.round(durationMs),
        queryId: meta.queryId,
        format: meta.format,
        paramKeys: meta.paramKeys,
        error,
      },
      `ClickHouse ${operation} failed`
    );

    incrementClickHouseQueryCount(
      operation === "query" ? "SELECT" : "INSERT",
      "error"
    );
    observeClickHouseQueryDuration(
      operation === "query" ? "SELECT" : "INSERT",
      meta.table ?? "unknown",
      durationMs / 1000
    );

    const shouldAlert = failureMonitor.record();
    if (shouldAlert) {
      queryLogger.fatal(
        {
          source: "clickhouse",
          alert: true,
          recentErrorType: errorType,
          windowMinutes: failureMonitor.windowMs / 60_000,
        },
        "ClickHouse failure rate threshold exceeded"
      );
    }
  } catch (loggingError) {
    logger.error({ loggingError }, "Failed to log ClickHouse query failure");
  }
}

function logQuerySuccess({
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

    incrementClickHouseQueryCount(
      operation === "query" ? "SELECT" : "INSERT",
      "success"
    );
    observeClickHouseQueryDuration(
      operation === "query" ? "SELECT" : "INSERT",
      meta.table ?? "unknown",
      durationMs / 1000
    );
  } catch (loggingError) {
    logger.error({ loggingError }, "Failed to log ClickHouse query success");
  }
}

/**
 * Wraps a ClickHouseClient with:
 * - Retry logic for `insert` (transient errors only)
 * - Structured logging for both `query` and `insert` (success + failure)
 * - Prometheus metrics integration
 * - Failure rate alerting
 */
export function createResilientClickHouseClient({
  client,
  failureMonitor = new FailureRateMonitor({
    threshold: 10,
    windowMs: 5 * 60_000,
  }),
  maxRetries = 3,
  baseDelayMs = 500,
  maxDelayMs = 10_000,
}: {
  client: ClickHouseClient;
  failureMonitor?: FailureRateMonitor;
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
      logQuerySuccess({ operation: "query", durationMs, params });
      return result;
    } catch (error) {
      const durationMs = performance.now() - start;
      logQueryFailure({
        operation: "query",
        error,
        durationMs,
        params,
        failureMonitor,
      });
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
        logQuerySuccess({ operation: "insert", durationMs, params });
        return result;
      } catch (error) {
        lastError = error;

        if (!isTransientClickHouseError(error) || attempt === maxRetries) {
          const durationMs = performance.now() - start;
          logQueryFailure({
            operation: "insert",
            error,
            durationMs,
            params,
            failureMonitor,
          });
          throw error;
        }

        const delay = jitteredBackoff({
          attempt,
          baseDelayMs,
          maxDelayMs,
        });

        try {
          const errorType = classifyClickHouseError(error);
          incrementClickHouseQueryCount("INSERT", "error");
          if (failureMonitor.record()) {
            queryLogger.fatal(
              {
                source: "clickhouse",
                alert: true,
                recentErrorType: errorType,
                windowMinutes: failureMonitor.windowMs / 60_000,
              },
              "ClickHouse failure rate threshold exceeded"
            );
          }

          logger.warn(
            {
              source: "clickhouse",
              operation: "insert",
              errorType,
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
