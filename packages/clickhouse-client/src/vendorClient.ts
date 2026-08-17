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
 *
 * Two neighbours carry the parts that are not policy. Reading facts back out of
 * the vendor's untyped params and rows is ./statementShape.ts. Saying what
 * happened — which sink, which level, which counter, and the guarantee that
 * none of it can throw into the caller's path — is ./statementReporting.ts.
 */

import { runWithRetry } from "./retry";
import {
  StatementReporter,
  type StatementLogSink,
  type StatementMetrics,
  type StatementOperation,
} from "./statementReporting";
import {
  extractQueryType,
  extractTableName,
  inbandExceptionOf,
  type VendorQueryType,
} from "./statementShape";

/**
 * Anything that can run the vendor's two statement methods. Method shorthand
 * on purpose: it compares bivariantly, so the real driver client — whose
 * params are narrower than `unknown` — satisfies it structurally.
 */
export interface VendorStatementClient {
  query(params: unknown): Promise<unknown>;
  insert(params: unknown): Promise<unknown>;
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
  /** Retry notices and this layer's own logging-failure guard. */
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
    | ((input: { error: unknown; durationMs: number }) => unknown)
    | undefined;
  /**
   * Names the time-partitioned table a SELECT scans without a prunable time
   * predicate, or null. The table list is host schema knowledge, so the
   * detector is injected rather than owned here. Omit to never warn.
   */
  detectColdScan?: ((rawQuery: string) => string | null) | undefined;
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
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly transientMessageFragments: readonly string[];
  private readonly report: StatementReporter;
  private readonly translateQueryError: (input: {
    error: unknown;
    durationMs: number;
  }) => unknown;

  constructor({
    cluster = "shared",
    maxRetries = 3,
    baseDelayMs = 500,
    maxDelayMs = 10_000,
    transientMessageFragments = [],
    metrics,
    noticeLogger,
    outcomeLogger,
    translateQueryError = ({ error }) => error,
    detectColdScan,
  }: VendorClientResilienceOptions = {}) {
    this.maxRetries = maxRetries;
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.transientMessageFragments = transientMessageFragments;
    this.translateQueryError = translateQueryError;
    this.report = new StatementReporter({
      cluster,
      metrics,
      noticeLogger,
      outcomeLogger,
      detectColdScan,
    });
  }

  /** Build one resilient client over the vendor's, preserving its type. */
  wrap<T extends VendorStatementClient>(client: T): T {
    const wrapper = Object.create(client) as T;

    wrapper.query = (async (params: unknown) => {
      const queryType = extractQueryType(params);
      const table = extractTableName(params);
      const start = now();
      try {
        const result = (await this.withTransientRetry({
          run: () => client.query(params),
          operation: "query",
        })) as { json?: (...args: never[]) => unknown };
        const durationMs = now() - start;
        this.report.success({ operation: "query", durationMs, params });
        this.report.outcome({
          queryType,
          table,
          durationMs,
          outcome: "success",
        });
        return this.guardInbandException({ result, startMs: start, params });
      } catch (error) {
        const durationMs = now() - start;
        this.report.failure({ operation: "query", error, durationMs, params });
        this.report.outcome({ queryType, table, durationMs, outcome: "error" });
        // Retries are exhausted at this point: hand the failure to the host's
        // translator so callers get whatever typed, actionable shape the host
        // defines for known ClickHouse failures.
        throw this.translateQueryError({ error, durationMs });
      }
    }) as T["query"];

    wrapper.insert = (async (params: unknown) => {
      const table =
        ((params as Record<string, unknown> | null)?.table as string) ??
        "unknown";
      const start = now();
      try {
        // Deliberately NOT retried here. See the note on this class.
        const result = await client.insert(params);
        const durationMs = now() - start;
        this.report.success({ operation: "insert", durationMs, params });
        this.report.outcome({
          queryType: "INSERT",
          table,
          durationMs,
          outcome: "success",
        });
        return result;
      } catch (error) {
        const durationMs = now() - start;
        this.report.failure({ operation: "insert", error, durationMs, params });
        this.report.outcome({
          queryType: "INSERT",
          table,
          durationMs,
          outcome: "error",
        });
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
  private withTransientRetry<R>({
    run,
    operation,
  }: {
    run: () => Promise<R>;
    operation: StatementOperation;
  }): Promise<R> {
    return runWithRetry(run, {
      // maxRetries counts retries after the first try; runWithRetry counts
      // tries.
      maxAttempts: this.maxRetries + 1,
      baseDelayMs: this.baseDelayMs,
      maxDelayMs: this.maxDelayMs,
      transientMessageFragments: this.transientMessageFragments,
      onRetry: (notice) => this.report.retryNotice({ operation, ...notice }),
    });
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
    return this.translateQueryError({ error, durationMs });
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
    const queryType: VendorQueryType = extractQueryType(params);
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
          this.report.failure({
            operation: "query",
            error,
            durationMs,
            params,
          });
          this.report.count({ queryType, outcome: "inband_error" });
          throw error;
        }
      }
      return rows;
    }) as R["json"];
    return result;
  }
}
