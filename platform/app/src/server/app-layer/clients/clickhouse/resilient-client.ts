import type { ClickHouseClient } from "@clickhouse/client";
import {
  QUERY_CAUSE_FIELD,
  RETRY_CAUSE_FIELD,
  runWithRetry,
} from "@langwatch/clickhouse-client";
import { createLogger } from "@langwatch/observability";
import {
  incrementClickHouseQueryCount,
  observeClickHouseQueryDuration,
} from "~/server/clickhouse/metrics";
import { CLICKHOUSE_TRANSIENT_MESSAGE_FRAGMENTS } from "~/server/event-sourcing/services/errorHandling";
import { detectColdScan } from "./cold-scan-detector";
import { translateClickHouseQueryError } from "./translate-query-error";
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
 * The whole retry policy - classification, backoff, how loudly to report an
 * attempt - lives in @langwatch/clickhouse-client, so every ClickHouse caller
 * in the repo answers to one implementation rather than a copy per layer.
 *
 * The transient-message list is still passed in from
 * event-sourcing/services/errorHandling.ts rather than owned by the package,
 * which keeps this layer and the outer group-queue classifier reading the same
 * list forever.
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
  return runWithRetry(fn, {
    // maxRetries counts retries after the first try; runWithRetry counts tries.
    maxAttempts: maxRetries + 1,
    baseDelayMs,
    maxDelayMs,
    transientMessageFragments: CLICKHOUSE_TRANSIENT_MESSAGE_FRAGMENTS,
    onRetry: ({ attempt, maxAttempts, delayMs, error, level }) => {
      try {
        logger[level](
          {
            source: "clickhouse",
            operation,
            attempt: attempt + 1,
            maxRetries: maxAttempts - 1,
            delayMs: Math.round(delayMs),
            [RETRY_CAUSE_FIELD]: error,
          },
          `Transient ClickHouse ${operation} error, retrying`,
        );
      } catch (loggingError) {
        logger.error(
          { loggingError },
          `Failed to log transient ${operation} retry`,
        );
      }
    },
  });
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

/**
 * Report an attempt that failed and was raised to the caller.
 *
 * Warn, not error, and the cause off the `error` field — the same two rules as
 * the vendor policy in `@langwatch/clickhouse-client`.
 *
 * The level is the substantive half. This wrapper does not know the outcome: a
 * read's translated error is reported at the request boundary, and an insert is
 * issued from a job the queue retries, which logs its own error and increments
 * `gq_jobs_dropped_total` if it ever truly gives up. Claiming a verdict here
 * made recovered work read as lost work — 17k records a day against zero jobs
 * actually dropped.
 *
 * The field name is consistency, not a fix: a warn record should not carry a
 * key asserting it failed. It does NOT change prod Loki's `detected_level`,
 * which never sees these fields — see the note on `REQUEST_CAUSE_FIELD` in
 * @langwatch/observability for why, and what actually fixes it.
 *
 * The failure is still counted: `incrementClickHouseQueryCount(_, "error")`
 * runs at every call site, and a rate is what the alerting is built on.
 */
function logFailure({
  operation,
  error,
  durationMs,
  params,
  cluster,
}: {
  operation: "query" | "insert";
  error: unknown;
  durationMs: number;
  params: unknown;
  cluster: string;
}): void {
  try {
    const meta = safeQueryMeta(params);

    queryLogger.warn(
      {
        source: "clickhouse",
        // Which ClickHouse refused it. Not every deployment has one cluster:
        // an organization can be routed to its own, so without this field a
        // rejection from a customer's dedicated instance is indistinguishable
        // from one on the shared cluster. On 2026-08-13 that ambiguity is what
        // made a three-hour saturation take an afternoon to attribute — the
        // answer had to be inferred from a concurrency limit quoted in the
        // vendor's error text and matched against terraform.
        cluster,
        operation,
        durationMs: Math.round(durationMs),
        queryId: meta.queryId,
        format: meta.format,
        paramKeys: meta.paramKeys,
        [QUERY_CAUSE_FIELD]: error,
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

    // A SELECT against a time-partitioned table with no predicate on its time
    // column cannot prune partitions, so it walks the whole history including
    // the cold tier on S3 - a burst of S3 GET requests per call. Worth warning
    // even when fast, because the cost is request count, not latency.
    const coldScanTable =
      operation === "query" ? detectColdScan(extractRawQuery(params)) : null;

    if (coldScanTable !== null) {
      queryLogger.warn(
        {
          source: "clickhouse",
          operation,
          durationMs: roundedMs,
          queryId: meta.queryId,
          table: meta.table,
          paramKeys: meta.paramKeys,
          query: extractQueryPreview(params),
          coldScan: true,
          coldScanTable,
        },
        `ClickHouse cold-scan ${operation}: cold scan of ${coldScanTable} (no time filter, walks S3 partitions)`,
      );
    } else {
      queryLogger.debug(
        {
          source: "clickhouse",
          operation,
          durationMs: roundedMs,
          queryId: meta.queryId,
        },
        `ClickHouse ${operation} succeeded`,
      );
    }
  } catch (loggingError) {
    logger.error({ loggingError }, "Failed to log ClickHouse query success");
  }
}

/**
 * ClickHouse streams results over HTTP. Once rows have been flushed, a
 * failure can no longer change the 200 status code, so the server writes the
 * error INTO the output as a final `{"exception": "..."}` line
 * (`http_write_exception_in_output_format`, on by default). The transport
 * never throws, the line parses as JSON, and without this guard it reaches
 * the caller as a "row" with none of the selected columns — which surfaces
 * as a property access on a missing column deep in a decoder, pointing every
 * investigation away from ClickHouse. (Observed live: a
 * MEMORY_LIMIT_EXCEEDED mid-`FINAL` arriving as a data row.)
 *
 * The guard wraps `json()` and throws the real ClickHouse error through the
 * same translator the catch path uses.
 */

/**
 * The server-side exception prefix, e.g.
 * `Code: 241. DB::Exception: Memory limit ... (MEMORY_LIMIT_EXCEEDED)`.
 * The class name is deliberately loose: the thrown type prints its own name
 * (`DB::NetException`, `DB::ErrnoException`, `Coordination::Exception`) and
 * every one of them means the query died. Missing one is the expensive
 * direction — it puts an error row back in front of a decoder.
 */
const CLICKHOUSE_EXCEPTION_SIGNATURE = /^Code: \d+\. (\w+::)?\w*Exception:/;

/**
 * A row is the server's exception line only when both hold: `exception` is
 * its sole key, and the value carries the ClickHouse error signature. The
 * sole-key test alone would reject a legitimate one-column result such as
 * `SELECT status AS exception`. A value that reproduces the full signature is
 * an accepted residual false positive — the stream offers nothing else to
 * tell it apart from the real thing.
 */
function inbandExceptionOf(row: unknown): string | undefined {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    return undefined;
  }
  if (Object.keys(row).length !== 1) return undefined;
  const exception = (row as { exception?: unknown }).exception;
  if (typeof exception !== "string") return undefined;
  return CLICKHOUSE_EXCEPTION_SIGNATURE.test(exception) ? exception : undefined;
}

function inbandExceptionError({
  message,
  durationMs,
}: {
  message: string;
  durationMs: number;
}): unknown {
  const error = new Error(message);
  const code = /Code:\s*(\d+)/.exec(message)?.[1];
  if (code) (error as { code?: string }).code = code;
  return translateClickHouseQueryError(error, durationMs);
}

/**
 * Outcome accounting is two-phase for streamed results. The transport-level
 * "success" is recorded when the query resolves — that cannot be deferred
 * to consumption, because a caller may stream() or never read the body at
 * all. When consumption then surfaces an in-band exception, the failure is
 * recorded HERE (failure log + error counter), so dashboards alerting on
 * errors see it. The earlier success increment is left standing and
 * documents itself as "the server accepted and started answering"; an
 * in-band failure therefore shows up as one success + one error for the
 * same query, never as silence.
 *
 * No transport-level retry happens for in-band exceptions: the body has
 * been consumed, and the classes that arrive in-band (memory limit, server
 * timeout) are not transient. Callers that need a retry get it from their
 * own layer — the job queue re-runs the whole unit of work.
 */
function guardInbandException<
  T extends { json?: (...args: never[]) => unknown },
>({
  result,
  startMs,
  params,
  cluster,
}: {
  result: T;
  startMs: number;
  params: unknown;
  cluster: string;
}): T {
  if (typeof result?.json !== "function") return result;
  const queryType = extractQueryType(params);
  const originalJson = result.json.bind(result);
  result.json = (async (...args: never[]) => {
    const rows = (await originalJson(...args)) as unknown;
    for (const row of Array.isArray(rows) ? rows : [rows]) {
      const exception = inbandExceptionOf(row);
      if (exception !== undefined) {
        const durationMs = performance.now() - startMs;
        const error = inbandExceptionError({ message: exception, durationMs });
        logFailure({ operation: "query", error, durationMs, params, cluster });
        // Dedicated outcome, and no second duration sample: the transport
        // outcome (success + one histogram observation) was already
        // recorded when the query resolved. Counting this as "error" too
        // would put one query under both terminal outcomes and corrupt
        // the success/error ratio.
        incrementClickHouseQueryCount(queryType, "inband_error");
        throw error;
      }
    }
    return rows;
  }) as T["json"];
  return result;
}

/**
 * Wraps a ClickHouseClient with structured logging, error translation, and
 * retry on reads only.
 *
 * Reads retry here because they are idempotent and nothing above them will do
 * it: a transient overload would otherwise surface as a failed page.
 *
 * Writes deliberately do not. Every insert in this system is issued from a job
 * on the group queue, which retries the whole job on its own backoff, so a
 * client-side retry does not add resilience - it multiplies attempts. The two
 * layers compounded: 4 attempts here inside up to 25 there, so one insert could
 * be tried ~100 times against a server that was rejecting precisely because it
 * was overloaded.
 *
 * It was also the unsafe half. These are async inserts
 * (`async_insert` + `wait_for_async_insert`, see ~/server/clickhouse/queryDefaults)
 * and `async_insert_deduplicate` is not set anywhere, so it takes ClickHouse's
 * default of off. A failure raised after the server has accepted the batch into
 * its buffer - `Query was cancelled`, or the memory limit hit while executing
 * `WaitForAsyncInsert`, which between them were most of the insert retries in
 * production - can still flush. Retrying then writes the rows twice.
 * ReplacingMergeTree collapses that for the tables keyed to collapse it; the
 * rollup and analytics tables just double-count.
 *
 * If insert retries are ever wanted back, make them idempotent first: set
 * `async_insert_deduplicate`, or pass a deterministic `insert_deduplication_token`
 * per batch.
 */
export function createResilientClickHouseClient({
  client,
  cluster = "shared",
  maxRetries = 3,
  baseDelayMs = 500,
  maxDelayMs = 10_000,
}: {
  client: ClickHouseClient;
  /**
   * Which ClickHouse this client talks to, stamped on every failure line.
   * Defaults to "shared" because that is what a caller naming nothing has.
   */
  cluster?: string;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}): ResilientClickHouseClient {
  const wrapper = Object.create(client) as ResilientClickHouseClient;

  wrapper.query = async (params) => {
    const queryType = extractQueryType(params);
    const table = extractTableName(params);
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
      return guardInbandException({ result, startMs: start, params, cluster });
    } catch (error) {
      const durationMs = performance.now() - start;
      logFailure({ operation: "query", error, durationMs, params, cluster });
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
      // Deliberately NOT retried here. See the note on this function.
      const result = await client.insert(params);
      const durationMs = performance.now() - start;
      logSuccess({ operation: "insert", durationMs, params });
      observeClickHouseQueryDuration("INSERT", insertTable, durationMs / 1000);
      incrementClickHouseQueryCount("INSERT", "success");
      return result;
    } catch (error) {
      const durationMs = performance.now() - start;
      logFailure({ operation: "insert", error, durationMs, params, cluster });
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
