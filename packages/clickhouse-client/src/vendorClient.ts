/**
 * Policy layer over the vendor client's `query`/`insert`, for statements
 * still going through `@clickhouse/client` directly rather than
 * {@link ClickHouseQueryClient}: retry, outcome metrics, in-band exceptions.
 */

import { runWithRetry } from "./retry.ts";
import {
  StatementReporter,
  type StatementLogSink,
  type StatementMetrics,
  type StatementOperation,
} from "./statementReporting.ts";
import { extractQueryType, extractTableName, inbandExceptionOf } from "./statementShape.ts";

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
  (globalThis as unknown as { performance: { now(): number } }).performance.now();

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
   * Translates a raised read error into what callers should see, applied
   * after retries exhaust and to in-band exceptions — never to insert
   * failures, whose callers classify the raw error themselves.
   */
  translateQueryError?: ((input: { error: unknown; durationMs: number }) => unknown) | undefined;
  /**
   * Names the time-partitioned table a SELECT scans without a prunable time
   * predicate, or null. The table list is host schema knowledge, so the
   * detector is injected rather than owned here. Omit to never warn.
   */
  detectColdScan?: ((rawQuery: string) => string | null) | undefined;
}

/** Complete retry/reporting policy supplied to a managed vendor client. */
export abstract class VendorClientPolicy {
  abstract wrap<Client extends VendorStatementClient>(client: Client, cluster: string): Client;
}

/** The standard vendor retry and reporting policy, configured once per process. */
export class VendorClientResiliencePolicy extends VendorClientPolicy {
  private constructor(private readonly options: VendorClientResilienceOptions) {
    super();
  }

  static create(options: VendorClientResilienceOptions = {}): VendorClientResiliencePolicy {
    return new VendorClientResiliencePolicy(options);
  }

  wrap<Client extends VendorStatementClient>(client: Client, cluster: string): Client {
    return new VendorClientResilience({ ...this.options, cluster }).wrap(client);
  }
}

/**
 * Reads retry (idempotent); inserts deliberately do not. Every insert already
 * retries via its queue job, and — being an async insert with no dedup token
 * set — a retry after the server buffers it can double-write the rows.
 */
export class VendorClientResilience {
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly transientMessageFragments: readonly string[];
  private readonly report: StatementReporter;
  private readonly translateQueryError: (input: { error: unknown; durationMs: number }) => unknown;

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
    return new Proxy(client, {
      get: (target, property) => {
        if (property === "query") return (params: unknown) => this.query(target, params);
        if (property === "insert") return (params: unknown) => this.insert(target, params);
        return Reflect.get(target, property, target);
      },
    });
  }

  private async query(client: VendorStatementClient, params: unknown): Promise<unknown> {
    const queryType = extractQueryType(params);
    const table = extractTableName(params);
    const start = now();
    try {
      const result = await this.withTransientRetry({
        run: () => client.query(params),
        operation: "query",
      });
      const durationMs = now() - start;
      this.report.success({ operation: "query", durationMs, params });
      this.report.outcome({ queryType, table, durationMs, outcome: "success" });
      return this.guardInbandException({ result, startMs: start, params });
    } catch (error) {
      const durationMs = now() - start;
      this.report.failure({ operation: "query", error, durationMs, params });
      this.report.outcome({ queryType, table, durationMs, outcome: "error" });
      throw this.translateQueryError({ error, durationMs });
    }
  }

  private async insert(client: VendorStatementClient, params: unknown): Promise<unknown> {
    const table = tableOf(params);
    const start = now();
    try {
      const result = await client.insert(params);
      const durationMs = now() - start;
      this.report.success({ operation: "insert", durationMs, params });
      this.report.outcome({ queryType: "INSERT", table, durationMs, outcome: "success" });
      return result;
    } catch (error) {
      const durationMs = now() - start;
      this.report.failure({ operation: "insert", error, durationMs, params });
      this.report.outcome({ queryType: "INSERT", table, durationMs, outcome: "error" });
      throw error;
    }
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
    if (code) Object.assign(error, { code });
    return this.translateQueryError({ error, durationMs });
  }

  /**
   * ClickHouse can flush a 200 then write a failure INTO the stream as a final
   * `{"exception": ...}` row; without this guard it reaches the caller as a
   * normal row missing every column instead of surfacing as an error.
   */
  private guardInbandException({
    result,
    startMs,
    params,
  }: {
    result: unknown;
    startMs: number;
    params: unknown;
  }): unknown {
    if (!isJsonResult(result)) return result;
    const queryType = extractQueryType(params);
    const originalJson = result.json.bind(result);
    result.json = async (...args: never[]) => {
      const rows = await originalJson(...args);
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
    };
    return result;
  }
}

type JsonResult = { json(...args: never[]): unknown };

function isJsonResult(value: unknown): value is JsonResult {
  return (
    value !== null &&
    typeof value === "object" &&
    "json" in value &&
    typeof value.json === "function"
  );
}

function tableOf(params: unknown): string {
  if (params === null || typeof params !== "object" || !("table" in params)) return "unknown";
  return typeof params.table === "string" ? params.table : "unknown";
}
