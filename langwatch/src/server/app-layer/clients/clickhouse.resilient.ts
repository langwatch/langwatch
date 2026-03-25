import type { ClickHouseClient } from "@clickhouse/client";
import { createLogger } from "~/utils/logger/server";
import {
  observeClickHouseQueryDuration,
  incrementClickHouseQueryCount,
} from "~/server/clickhouse/metrics";

const logger = createLogger("langwatch:clickhouse:resilient");
const queryLogger = createLogger("langwatch:clickhouse:query");

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

export type ClickHouseErrorType =
  | "oom"
  | "timeout"
  | "network"
  | "rate_limit"
  | "unavailable"
  | "syntax"
  | "unknown";

const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ENOTFOUND",
]);

const TRANSIENT_NETWORK_CODES = new Set([
  ...NETWORK_CODES,
  "ETIMEDOUT",
]);

const TRANSIENT_HTTP_STATUSES = new Set([503, 429]);

/**
 * Classifies a ClickHouse error into a well-known category for structured
 * logging and alerting. Returns a short string tag suitable for log fields
 * and Prometheus labels.
 */
export function classifyClickHouseError(error: unknown): ClickHouseErrorType {
  if (!(error instanceof Error)) return "unknown";

  const message = error.message;

  // OOM
  if (message.includes("MEMORY_LIMIT_EXCEEDED")) return "oom";

  // Timeout (message or errno code)
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ETIMEDOUT" || /timeout/i.test(message)) return "timeout";

  // Network
  if (code && NETWORK_CODES.has(code)) return "network";

  // HTTP status-based classification
  const status =
    (error as { statusCode?: number }).statusCode ??
    (error as { status?: number }).status;

  if (status === 429) return "rate_limit";
  if (status === 503) return "unavailable";

  // Syntax / schema
  if (
    message.includes("SYNTAX_ERROR") ||
    message.includes("Unknown column") ||
    message.includes("Missing columns")
  )
    return "syntax";

  return "unknown";
}

export function isTransientClickHouseError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message;

  if (message.includes("MEMORY_LIMIT_EXCEEDED")) return true;
  if (/timeout/i.test(message)) return true;

  const code = (error as NodeJS.ErrnoException).code;
  if (code && TRANSIENT_NETWORK_CODES.has(code)) return true;

  const status =
    (error as { statusCode?: number }).statusCode ??
    (error as { status?: number }).status;
  if (status && TRANSIENT_HTTP_STATUSES.has(status)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Failure rate monitor (sliding window)
// ---------------------------------------------------------------------------

/**
 * Tracks failure timestamps in a sliding window. When the count exceeds
 * `threshold` within `windowMs`, `record()` returns `true` to signal an
 * alert. A cooldown prevents repeated alerts from flooding logs.
 */
export class FailureRateMonitor {
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly cooldownMs: number;
  private timestamps: number[] = [];
  private lastAlertAt = 0;

  constructor({
    threshold,
    windowMs,
    cooldownMs = 5 * 60_000,
  }: {
    threshold: number;
    windowMs: number;
    cooldownMs?: number;
  }) {
    this.threshold = threshold;
    this.windowMs = windowMs;
    this.cooldownMs = cooldownMs;
  }

  /**
   * Records a failure. Returns `true` when the threshold is breached and no
   * alert was fired within the cooldown period.
   */
  record(): boolean {
    const now = Date.now();
    this.timestamps.push(now);
    this.prune(now);

    if (this.timestamps.length < this.threshold) return false;
    if (now - this.lastAlertAt < this.cooldownMs) return false;

    this.lastAlertAt = now;
    return true;
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    // timestamps are in order, so find first index >= cutoff
    let i = 0;
    while (i < this.timestamps.length && this.timestamps[i]! < cutoff) {
      i++;
    }
    if (i > 0) {
      this.timestamps = this.timestamps.slice(i);
    }
  }
}

// ---------------------------------------------------------------------------
// Resilient proxy
// ---------------------------------------------------------------------------

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

/** Extract safe metadata from query params (keys only, no values). */
function safeQueryMeta(params: unknown): {
  queryId?: string;
  format?: string;
  paramKeys?: string[];
} {
  if (!params || typeof params !== "object") return {};
  const p = params as Record<string, unknown>;
  const meta: { queryId?: string; format?: string; paramKeys?: string[] } = {};

  if (typeof p.query_id === "string") meta.queryId = p.query_id;
  if (typeof p.format === "string") meta.format = p.format;
  if (p.query_params && typeof p.query_params === "object") {
    meta.paramKeys = Object.keys(p.query_params as Record<string, unknown>);
  }

  return meta;
}

const failureMonitor = new FailureRateMonitor({
  threshold: 10,
  windowMs: 5 * 60_000,
});

function logQueryFailure({
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
      error: error instanceof Error ? error.message : String(error),
    },
    `ClickHouse ${operation} failed`
  );

  incrementClickHouseQueryCount(
    operation === "query" ? "SELECT" : "INSERT",
    "error"
  );
  observeClickHouseQueryDuration(
    operation === "query" ? "SELECT" : "INSERT",
    "unknown",
    durationMs / 1000
  );

  const shouldAlert = failureMonitor.record();
  if (shouldAlert) {
    queryLogger.fatal(
      {
        source: "clickhouse",
        alert: true,
        recentErrorType: errorType,
        windowMinutes: 5,
      },
      "ClickHouse failure rate threshold exceeded"
    );
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
    "unknown",
    durationMs / 1000
  );
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
  maxRetries = 3,
  baseDelayMs = 500,
  maxDelayMs = 10_000,
}: {
  client: ClickHouseClient;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}): ClickHouseClient {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "query") {
        return async (...args: unknown[]) => {
          const start = performance.now();
          const params = args[0];
          try {
            const result = await (target.query as Function).apply(
              target,
              args
            );
            const durationMs = performance.now() - start;
            logQuerySuccess({ operation: "query", durationMs, params });
            return result;
          } catch (error) {
            const durationMs = performance.now() - start;
            logQueryFailure({ operation: "query", error, durationMs, params });
            throw error;
          }
        };
      }

      if (prop === "insert") {
        return async (...args: unknown[]) => {
          const start = performance.now();
          const params = args[0];
          let lastError: unknown;

          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
              const result = await (target.insert as Function).apply(
                target,
                args
              );
              const durationMs = performance.now() - start;
              logQuerySuccess({ operation: "insert", durationMs, params });
              return result;
            } catch (error) {
              lastError = error;

              if (
                !isTransientClickHouseError(error) ||
                attempt === maxRetries
              ) {
                const durationMs = performance.now() - start;
                logQueryFailure({
                  operation: "insert",
                  error,
                  durationMs,
                  params,
                });
                throw error;
              }

              const delay = jitteredBackoff({
                attempt,
                baseDelayMs,
                maxDelayMs,
              });
              logger.warn(
                {
                  attempt: attempt + 1,
                  maxRetries,
                  delayMs: Math.round(delay),
                  error:
                    error instanceof Error ? error.message : String(error),
                },
                "Transient ClickHouse insert error, retrying"
              );

              await new Promise((resolve) => setTimeout(resolve, delay));
            }
          }

          throw lastError;
        };
      }

      return Reflect.get(target, prop, receiver);
    },
  });
}
