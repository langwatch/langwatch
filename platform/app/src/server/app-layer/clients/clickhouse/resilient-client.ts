import type { ClickHouseClient } from "@clickhouse/client";
import { CLICKHOUSE_TRANSIENT_MESSAGE_FRAGMENTS } from "@langwatch/clickhouse";
import { createLogger } from "@langwatch/observability";
import {
  incrementClickHouseQueryCount,
  incrementConventionViolation,
  observeClickHouseQueryDuration,
} from "~/server/clickhouse/metrics";
import { enforceConventions } from "./convention-gate";
import {
  TRANSIENT_NETWORK_CODES,
  translateClickHouseQueryError,
} from "./translate-query-error";
import { queryWindowed } from "./windowed-read";

/**
 * A resilient ClickHouse client: a {@link ClickHouseClient} whose `query`/`insert`
 * carry retry + error translation, plus {@link queryWindowed} for the
 * partition-pruning-window-with-fallback read pattern. Repositories resolve one
 * of these and call `queryWindowed` without a cast.
 */
export type ResilientClickHouseClient = ClickHouseClient & {
  queryWindowed: typeof queryWindowed;
};

const logger = createLogger("langwatch:clickhouse:resilient");
const queryLogger = createLogger("langwatch:clickhouse:query");

/**
 * Reuses the canonical transient-message list from
 * event-sourcing/services/errorHandling.ts so the inline insert retry
 * loop catches the exact same set of cluster-recovery cases (ZK
 * reconnect, replica shutdown, KILL during graceful shutdown, overload)
 * as the outer group-queue retry classifier. Importing instead of
 * duplicating keeps the two layers in lock-step forever.
 */
function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message;
  if (/timeout/i.test(message)) return true;
  for (const fragment of CLICKHOUSE_TRANSIENT_MESSAGE_FRAGMENTS) {
    if (message.includes(fragment)) return true;
  }

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

/**
 * Runs an operation against ClickHouse, retrying transient failures with
 * jittered backoff. Both reads and writes use this: a read rejected with
 * "Too many simultaneous queries" (or any other transient overload /
 * cluster-recovery condition) frees up within moments, and reads are
 * idempotent, so retrying rides through the spike instead of surfacing a
 * 500 to the user. Non-transient errors (e.g. a query syntax error) fail
 * fast on the first attempt.
 */
async function withTransientRetry<T>(
  fn: () => Promise<T>,
  {
    operation,
    maxRetries,
    baseDelayMs,
    maxDelayMs,
  }: {
    operation: "query" | "insert";
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
  },
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (!isTransientError(error) || attempt === maxRetries) {
        throw error;
      }

      const delay = jitteredBackoff({ attempt, baseDelayMs, maxDelayMs });

      try {
        logger.warn(
          {
            source: "clickhouse",
            operation,
            attempt: attempt + 1,
            maxRetries,
            delayMs: Math.round(delay),
            error,
          },
          `Transient ClickHouse ${operation} error, retrying`,
        );
      } catch (loggingError) {
        logger.error(
          { loggingError },
          `Failed to log transient ${operation} retry`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
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

function extractQueryType(params: unknown): "SELECT" | "INSERT" | "OTHER" {
  if (!params || typeof params !== "object") return "OTHER";
  const p = params as Record<string, unknown>;
  if (typeof p.query !== "string") return "OTHER";
  const trimmed = p.query.trimStart().toUpperCase();
  if (trimmed.startsWith("SELECT") || trimmed.startsWith("WITH"))
    return "SELECT";
  if (trimmed.startsWith("INSERT")) return "INSERT";
  return "OTHER";
}

function extractTableName(params: unknown): string {
  const meta = safeQueryMeta(params);
  return meta.table ?? "unknown";
}

function extractQueryPreview(params: unknown): string | undefined {
  if (!params || typeof params !== "object") return undefined;
  const p = params as Record<string, unknown>;
  if (typeof p.query !== "string") return undefined;
  return p.query.length > 200 ? p.query.slice(0, 200) + "..." : p.query;
}

function extractRawQuery(params: unknown): string {
  if (!params || typeof params !== "object") return "";
  const p = params as Record<string, unknown>;
  return typeof p.query === "string" ? p.query : "";
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
      `ClickHouse ${operation} failed`,
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
    const roundedMs = Math.round(durationMs);
    const meta = safeQueryMeta(params);

    queryLogger.debug(
      {
        source: "clickhouse",
        operation,
        durationMs: roundedMs,
        queryId: meta.queryId,
      },
      `ClickHouse ${operation} succeeded`,
    );
  } catch (loggingError) {
    logger.error({ loggingError }, "Failed to log ClickHouse query success");
  }
}

/**
 * The gate check for the LEGACY driver funnel, BEFORE the query is sent.
 *
 * The new packages client gets the same gate injected at construction; this
 * path exists for the driver-based clients that have not migrated yet. One
 * decision function serves both — see enforceConventions.
 */
function countConventionViolations(params: unknown): void {
  const query = extractRawQuery(params);
  enforceConventions(query, {
    onViolation: ({ table, rule }) => incrementConventionViolation(table, rule),
    warn: (violations) => {
      const meta = safeQueryMeta(params);
      queryLogger.warn(
        {
          source: "clickhouse",
          operation: "query",
          queryId: meta.queryId,
          table: meta.table,
          paramKeys: meta.paramKeys,
          query: extractQueryPreview(params),
          conventionViolations: violations,
        },
        `ClickHouse convention violation: ${violations
          .map(({ table, rule }) => `${table} ${rule}`)
          .join(", ")}`,
      );
    },
  });
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
}): ResilientClickHouseClient {
  const wrapper = Object.create(client) as ResilientClickHouseClient;

  wrapper.query = async (params) => {
    const queryType = extractQueryType(params);
    const table = extractTableName(params);
    countConventionViolations(params);
    const start = performance.now();
    try {
      const result = await withTransientRetry(
        () => client.query(params as Parameters<typeof client.query>[0]),
        { operation: "query", maxRetries, baseDelayMs, maxDelayMs },
      );
      const durationMs = performance.now() - start;
      logSuccess({ operation: "query", durationMs, params });
      observeClickHouseQueryDuration(queryType, table, durationMs / 1000);
      incrementClickHouseQueryCount(queryType, "success");
      return result;
    } catch (error) {
      const durationMs = performance.now() - start;
      logFailure({ operation: "query", error, durationMs, params });
      observeClickHouseQueryDuration(queryType, table, durationMs / 1000);
      incrementClickHouseQueryCount(queryType, "error");
      // Retries are exhausted at this point: translate known ClickHouse
      // failures (memory limit, timeout, connection) into typed HandledErrors
      // so callers get actionable errors with remediation tips. The raw error
      // rides along in `reasons` for the retry classifiers (see
      // translate-query-error.ts).
      throw translateClickHouseQueryError(error, durationMs);
    }
  };

  wrapper.insert = async (params) => {
    const insertTable =
      ((params as unknown as Record<string, unknown>).table as string) ??
      "unknown";
    const start = performance.now();
    try {
      const result = await withTransientRetry(() => client.insert(params), {
        operation: "insert",
        maxRetries,
        baseDelayMs,
        maxDelayMs,
      });
      const durationMs = performance.now() - start;
      logSuccess({ operation: "insert", durationMs, params });
      observeClickHouseQueryDuration("INSERT", insertTable, durationMs / 1000);
      incrementClickHouseQueryCount("INSERT", "success");
      return result;
    } catch (error) {
      const durationMs = performance.now() - start;
      logFailure({ operation: "insert", error, durationMs, params });
      observeClickHouseQueryDuration("INSERT", insertTable, durationMs / 1000);
      incrementClickHouseQueryCount("INSERT", "error");
      throw error;
    }
  };

  // Orchestration only — the caller's `run` closure issues each attempt through
  // this same wrapper's `query`, so retry + error translation apply per windowed
  // attempt. Assigned by reference to preserve the generic signature.
  wrapper.queryWindowed = queryWindowed;

  return wrapper;
}
