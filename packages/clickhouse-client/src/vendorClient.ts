/**
 * Resilience over the vendor client's own `query`/`insert`.
 *
 * Most of this repo's statements still go through `@clickhouse/client`
 * directly rather than through the {@link ClickHouseQueryClient} port, and
 * this class is the policy layer they get: retry on transient read failures,
 * outcome logging that names the cluster, an outcome metric per statement, and
 * the in-band exception guard for streamed results.
 *
 * The vendor package itself is deliberately not imported. Everything here is
 * declared structurally — a client is anything with `query` and `insert`, a
 * result is anything with a `json` method — which is what keeps this package
 * free of the driver dependency and lets a test double be an object literal.
 * The host supplies what is host-specific through ports: where metrics go,
 * where log lines go, how a raised error is translated for its callers, and
 * which queries count as cold scans.
 */

import { QUERY_CAUSE_FIELD, RETRY_CAUSE_FIELD } from "./resilience";
import { runWithRetry } from "./retry";

/**
 * Anything that can run the vendor's two statement methods. Method shorthand
 * on purpose: it compares bivariantly, so the real driver client — whose
 * params are narrower than `unknown` — satisfies it structurally.
 */
export interface VendorStatementClient {
  query(params: unknown): Promise<unknown>;
  insert(params: unknown): Promise<unknown>;
}

/** The statement categories the outcome metric is labelled by. */
export type VendorQueryType = "SELECT" | "INSERT" | "OTHER";

/**
 * How a statement ended, as the metric counts it. `inband_error` is a
 * transport-level success whose streamed body carried the server's exception
 * line — a dedicated outcome so one query is never counted under two terminal
 * ones. See the in-band guard on {@link VendorClientResilience.wrap}.
 */
export type StatementOutcome = "success" | "error" | "inband_error";

/** Where per-statement outcomes are counted. Omit to count nowhere. */
export interface StatementMetrics {
  observeDuration(
    queryType: VendorQueryType,
    table: string,
    durationSeconds: number,
  ): void;
  incrementCount(queryType: VendorQueryType, outcome: StatementOutcome): void;
}

/** The subset of a structured logger this class writes through. */
export interface StatementLogSink {
  debug(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

/**
 * Reached through `globalThis` so the package needs neither the Node nor the
 * DOM lib to build — the same reason ./retry.ts reaches its timer this way.
 * Every host that can run a query has a monotonic clock.
 */
const now = (): number =>
  (
    globalThis as unknown as { performance: { now(): number } }
  ).performance.now();

const NOOP_SINK: StatementLogSink = {
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const NOOP_METRICS: StatementMetrics = {
  observeDuration: () => undefined,
  incrementCount: () => undefined,
};

export interface VendorClientResilienceOptions {
  /**
   * Which ClickHouse the wrapped client talks to, stamped on every failure
   * line. Defaults to "shared" because that is what a caller naming nothing
   * has.
   */
  cluster?: string | undefined;
  maxRetries?: number | undefined;
  baseDelayMs?: number | undefined;
  maxDelayMs?: number | undefined;
  /**
   * Message fragments that mark a ClickHouse-side transient condition. Owned
   * by the caller so this class and the caller's outer queue classifier read
   * the same list forever — see ./resilience.ts.
   */
  transientMessageFragments?: readonly string[] | undefined;
  /** Outcome counters and the latency histogram. Omit to record none. */
  metrics?: StatementMetrics | undefined;
  /** Retry notices and this class's own logging-failure guard. */
  noticeLogger?: StatementLogSink | undefined;
  /** Per-statement outcome lines: failures, cold scans, debug successes. */
  outcomeLogger?: StatementLogSink | undefined;
  /**
   * Translates a raised read error into what the host's callers should see —
   * typically a typed error with remediation. Applied after retries are
   * exhausted and to in-band exceptions; never to insert failures, whose
   * callers are queue jobs that classify the raw error themselves. Omit to
   * raise errors untranslated.
   */
  translateQueryError?:
    | ((error: unknown, durationMs: number) => unknown)
    | undefined;
  /**
   * Names the time-partitioned table a SELECT scans without a prunable time
   * predicate, or null. The table list is host schema knowledge, so the
   * detector is injected rather than owned here. Omit to never warn.
   */
  detectColdScan?: ((rawQuery: string) => string | null) | undefined;
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

function extractQueryType(params: unknown): VendorQueryType {
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

/**
 * The resilience policy a vendor-shaped client is wrapped in, held as one
 * object so it is configured once and applied to every client the same way.
 *
 * Reads retry because they are idempotent and nothing above them will do it: a
 * transient overload would otherwise surface as a failed page.
 *
 * Writes deliberately do not. Every insert in this system is issued from a job
 * on a queue that retries the whole job on its own backoff, so a client-side
 * retry does not add resilience - it multiplies attempts. The two layers
 * compounded: 4 attempts here inside up to 25 there, so one insert could be
 * tried ~100 times against a server that was rejecting precisely because it
 * was overloaded.
 *
 * It was also the unsafe half. These are async inserts (`async_insert` +
 * `wait_for_async_insert`) and `async_insert_deduplicate` is not set anywhere,
 * so it takes ClickHouse's default of off. A failure raised after the server
 * has accepted the batch into its buffer - `Query was cancelled`, or the
 * memory limit hit while executing `WaitForAsyncInsert`, which between them
 * were most of the insert retries in production - can still flush. Retrying
 * then writes the rows twice. ReplacingMergeTree collapses that for the tables
 * keyed to collapse it; the rollup and analytics tables just double-count.
 *
 * If insert retries are ever wanted back, make them idempotent first: set
 * `async_insert_deduplicate`, or pass a deterministic
 * `insert_deduplication_token` per batch.
 */
export class VendorClientResilience {
  private readonly cluster: string;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly transientMessageFragments: readonly string[];
  private readonly metrics: StatementMetrics;
  private readonly noticeLogger: StatementLogSink;
  private readonly outcomeLogger: StatementLogSink;
  private readonly translateQueryError: (
    error: unknown,
    durationMs: number,
  ) => unknown;
  private readonly detectColdScan: (rawQuery: string) => string | null;

  constructor({
    cluster = "shared",
    maxRetries = 3,
    baseDelayMs = 500,
    maxDelayMs = 10_000,
    transientMessageFragments = [],
    metrics = NOOP_METRICS,
    noticeLogger = NOOP_SINK,
    outcomeLogger = NOOP_SINK,
    translateQueryError = (error) => error,
    detectColdScan = () => null,
  }: VendorClientResilienceOptions = {}) {
    this.cluster = cluster;
    this.maxRetries = maxRetries;
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.transientMessageFragments = transientMessageFragments;
    this.metrics = metrics;
    this.noticeLogger = noticeLogger;
    this.outcomeLogger = outcomeLogger;
    this.translateQueryError = translateQueryError;
    this.detectColdScan = detectColdScan;
  }

  /** Build one resilient client over the vendor's, preserving its type. */
  wrap<T extends VendorStatementClient>(client: T): T {
    const wrapper = Object.create(client) as T;

    wrapper.query = (async (params: unknown) => {
      const queryType = extractQueryType(params);
      const table = extractTableName(params);
      const start = now();
      try {
        const result = (await this.withTransientRetry(
          () => client.query(params),
          "query",
        )) as { json?: (...args: never[]) => unknown };
        const durationMs = now() - start;
        this.logSuccess({ operation: "query", durationMs, params });
        this.metrics.observeDuration(queryType, table, durationMs / 1000);
        this.metrics.incrementCount(queryType, "success");
        return this.guardInbandException({ result, startMs: start, params });
      } catch (error) {
        const durationMs = now() - start;
        this.logFailure({ operation: "query", error, durationMs, params });
        this.metrics.observeDuration(queryType, table, durationMs / 1000);
        this.metrics.incrementCount(queryType, "error");
        // Retries are exhausted at this point: hand the failure to the host's
        // translator so callers get whatever typed, actionable shape the host
        // defines for known ClickHouse failures.
        throw this.translateQueryError(error, durationMs);
      }
    }) as T["query"];

    wrapper.insert = (async (params: unknown) => {
      const insertTable =
        ((params as Record<string, unknown> | null)?.table as string) ??
        "unknown";
      const start = now();
      try {
        // Deliberately NOT retried here. See the note on this class.
        const result = await client.insert(params);
        const durationMs = now() - start;
        this.logSuccess({ operation: "insert", durationMs, params });
        this.metrics.observeDuration("INSERT", insertTable, durationMs / 1000);
        this.metrics.incrementCount("INSERT", "success");
        return result;
      } catch (error) {
        const durationMs = now() - start;
        this.logFailure({ operation: "insert", error, durationMs, params });
        this.metrics.observeDuration("INSERT", insertTable, durationMs / 1000);
        this.metrics.incrementCount("INSERT", "error");
        throw error;
      }
    }) as T["insert"];

    return wrapper;
  }

  /**
   * The whole retry policy - classification, backoff, how loudly to report an
   * attempt - is ./retry.ts and ./resilience.ts, so every ClickHouse caller
   * answers to one implementation rather than a copy per layer.
   */
  private withTransientRetry<R>(
    fn: () => Promise<R>,
    operation: "query" | "insert",
  ): Promise<R> {
    return runWithRetry(fn, {
      // maxRetries counts retries after the first try; runWithRetry counts
      // tries.
      maxAttempts: this.maxRetries + 1,
      baseDelayMs: this.baseDelayMs,
      maxDelayMs: this.maxDelayMs,
      transientMessageFragments: this.transientMessageFragments,
      onRetry: ({ attempt, maxAttempts, delayMs, error, level }) => {
        try {
          this.noticeLogger[level](
            {
              source: "clickhouse",
              // Which ClickHouse refused the attempt. For a transient failure
              // that later succeeds this is the ONLY line emitted — logFailure
              // never runs — so without it a recovered failure on a customer's
              // private instance is indistinguishable from one on the shared
              // cluster.
              cluster: this.cluster,
              operation,
              attempt: attempt + 1,
              maxRetries: maxAttempts - 1,
              delayMs: Math.round(delayMs),
              [RETRY_CAUSE_FIELD]: error,
            },
            `Transient ClickHouse ${operation} error, retrying`,
          );
        } catch (loggingError) {
          this.noticeLogger.error(
            { loggingError },
            `Failed to log transient ${operation} retry`,
          );
        }
      },
    });
  }

  /**
   * Report an attempt that failed and was raised to the caller.
   *
   * Warn, not error, and the cause off the `error` field — the same two rules
   * as the vendor-log policy in ./logging.ts.
   *
   * The level is the substantive half. This wrapper does not know the outcome:
   * a read's translated error is reported at the request boundary, and an
   * insert is issued from a job the queue retries, which logs its own error
   * and counts what it drops if it ever truly gives up. Claiming a verdict
   * here made recovered work read as lost work — 17k records a day against
   * zero jobs actually dropped.
   *
   * The failure is still counted: `metrics.incrementCount(_, "error")` runs at
   * every call site, and a rate is what the alerting is built on.
   */
  private logFailure({
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

      this.outcomeLogger.warn(
        {
          source: "clickhouse",
          // Which ClickHouse refused it. Not every deployment has one cluster:
          // an organization can be routed to its own, so without this field a
          // rejection from a customer's dedicated instance is
          // indistinguishable from one on the shared cluster. On 2026-08-13
          // that ambiguity is what made a three-hour saturation take an
          // afternoon to attribute — the answer had to be inferred from a
          // concurrency limit quoted in the vendor's error text and matched
          // against terraform.
          cluster: this.cluster,
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
      this.noticeLogger.error(
        { loggingError },
        "Failed to log ClickHouse query failure",
      );
    }
  }

  private logSuccess({
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

      // A SELECT against a time-partitioned table with no predicate on its
      // time column cannot prune partitions, so it walks the whole history
      // including any cold tier on object storage - a burst of GET requests
      // per call. Worth warning even when fast, because the cost is request
      // count, not latency.
      const coldScanTable =
        operation === "query"
          ? this.detectColdScan(extractRawQuery(params))
          : null;

      if (coldScanTable !== null) {
        this.outcomeLogger.warn(
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
        this.outcomeLogger.debug(
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
      this.noticeLogger.error(
        { loggingError },
        "Failed to log ClickHouse query success",
      );
    }
  }

  private inbandExceptionError({
    message,
    durationMs,
  }: {
    message: string;
    durationMs: number;
  }): unknown {
    const error = new Error(message);
    const code = /Code:\s*(\d+)/.exec(message)?.[1];
    if (code) (error as { code?: string }).code = code;
    return this.translateQueryError(error, durationMs);
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
  private guardInbandException<
    R extends { json?: (...args: never[]) => unknown },
  >({
    result,
    startMs,
    params,
  }: {
    result: R;
    startMs: number;
    params: unknown;
  }): R {
    if (typeof result?.json !== "function") return result;
    const queryType = extractQueryType(params);
    const originalJson = result.json.bind(result);
    result.json = (async (...args: never[]) => {
      const rows = (await originalJson(...args)) as unknown;
      for (const row of Array.isArray(rows) ? rows : [rows]) {
        const exception = inbandExceptionOf(row);
        if (exception !== undefined) {
          const durationMs = now() - startMs;
          const error = this.inbandExceptionError({
            message: exception,
            durationMs,
          });
          this.logFailure({ operation: "query", error, durationMs, params });
          // Dedicated outcome, and no second duration sample: the transport
          // outcome (success + one histogram observation) was already
          // recorded when the query resolved. Counting this as "error" too
          // would put one query under both terminal outcomes and corrupt
          // the success/error ratio.
          this.metrics.incrementCount(queryType, "inband_error");
          throw error;
        }
      }
      return rows;
    }) as R["json"];
    return result;
  }
}
