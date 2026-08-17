/**
 * Everything the vendor-client policy says about a statement, and nowhere it
 * decides anything.
 *
 * Split from ./vendorClient.ts because the two answer different questions. That
 * module decides what happens to a statement — retry it, refuse it, guard its
 * stream. This one decides how the outcome is described: which sink, which
 * level, which fields, which counter.
 *
 * ## Why the ports are guarded here and not at the call sites
 *
 * The rule is ./observability.ts: reporting must not change what it reports.
 * Most of these calls run inside a `catch`, where a throw from a counter or a
 * log sink propagates *in place of* the ClickHouse error — the caller is handed
 * a telemetry failure and never learns what actually broke.
 *
 * Holding that rule by wrapping each call is a discipline, and disciplines are
 * forgotten by the next person to add a metric. So the ports are wrapped once,
 * on the way in: {@link StatementReporter} stores guarded views of whatever the
 * host passed, and every method below is then a plain call. Being unable to
 * throw is a property of the port, not of the code that uses it.
 *
 * The outcome sink is the one exception, and deliberately: its failure is worth
 * a line, so it is called raw and its throw reported on the notice sink. The
 * notice sink is guarded because it is the last resort — there is nowhere left
 * to report *its* failure, which also covers the host that passes one logger
 * for both and so breaks both at once.
 */

import { quietly } from "./observability";
import { QUERY_CAUSE_FIELD, RETRY_CAUSE_FIELD } from "./resilience";
import type { RetryAttemptNotice } from "./retry";
import {
  extractQueryPreview,
  extractRawQuery,
  safeQueryMeta,
  type VendorQueryType,
} from "./statementShape";

/**
 * How a statement ended, as the metric counts it. `inband_error` is a
 * transport-level success whose streamed body carried the server's exception
 * line — a dedicated outcome so one query is never counted under two terminal
 * ones.
 */
export type StatementOutcome = "success" | "error" | "inband_error";

/** Which of the vendor's two statement methods produced the outcome. */
export type StatementOperation = "query" | "insert";

/** Where per-statement outcomes are counted. Omit to count nowhere. */
export interface StatementMetrics {
  observeDuration(input: {
    queryType: VendorQueryType;
    table: string;
    durationSeconds: number;
  }): void;
  incrementCount(input: {
    queryType: VendorQueryType;
    outcome: StatementOutcome;
  }): void;
}

/** The subset of a structured logger this package writes through. */
export interface StatementLogSink {
  debug(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

/**
 * A view of `metrics` that cannot throw.
 *
 * Written out rather than derived by walking the object's keys: a host may pass
 * a class instance whose methods live on the prototype, and reflection over own
 * properties would silently hand back a port with nothing guarded.
 */
export function guardedMetrics(metrics: StatementMetrics): StatementMetrics {
  return {
    observeDuration: (input) => quietly(() => metrics.observeDuration(input)),
    incrementCount: (input) => quietly(() => metrics.incrementCount(input)),
  };
}

/** A view of `sink` that cannot throw. See {@link guardedMetrics}. */
export function guardedLogSink(sink: StatementLogSink): StatementLogSink {
  return {
    debug: (fields, message) => quietly(() => sink.debug(fields, message)),
    warn: (fields, message) => quietly(() => sink.warn(fields, message)),
    error: (fields, message) => quietly(() => sink.error(fields, message)),
  };
}

const NOOP_SINK: StatementLogSink = {
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const NOOP_METRICS: StatementMetrics = {
  observeDuration: () => undefined,
  incrementCount: () => undefined,
};

export interface StatementReporterOptions {
  cluster?: string | undefined;
  metrics?: StatementMetrics | undefined;
  noticeLogger?: StatementLogSink | undefined;
  outcomeLogger?: StatementLogSink | undefined;
  detectColdScan?: ((rawQuery: string) => string | null) | undefined;
}

export class StatementReporter {
  private readonly cluster: string;
  /** Guarded on the way in — see the note on this module. */
  private readonly metrics: StatementMetrics;
  /** Guarded on the way in: the last resort has nowhere to report a failure. */
  private readonly noticeLogger: StatementLogSink;
  /** Raw on purpose: a failure here is worth a line on the notice sink. */
  private readonly outcomeLogger: StatementLogSink;
  private readonly detectColdScan: (rawQuery: string) => string | null;

  constructor({
    cluster = "shared",
    metrics = NOOP_METRICS,
    noticeLogger = NOOP_SINK,
    outcomeLogger = NOOP_SINK,
    detectColdScan = () => null,
  }: StatementReporterOptions = {}) {
    this.cluster = cluster;
    this.metrics = guardedMetrics(metrics);
    this.noticeLogger = guardedLogSink(noticeLogger);
    this.outcomeLogger = outcomeLogger;
    this.detectColdScan = detectColdScan;
  }

  /** Count one finished statement. */
  outcome({
    queryType,
    table,
    durationMs,
    outcome,
  }: {
    queryType: VendorQueryType;
    table: string;
    durationMs: number;
    outcome: StatementOutcome;
  }): void {
    this.metrics.observeDuration({
      queryType,
      table,
      durationSeconds: durationMs / 1000,
    });
    this.metrics.incrementCount({ queryType, outcome });
  }

  /**
   * Count an outcome with no new duration sample.
   *
   * The in-band case only: the transport outcome — success plus one histogram
   * observation — was already recorded when the query resolved. Observing a
   * second duration for the same statement would double-count it.
   */
  count({
    queryType,
    outcome,
  }: {
    queryType: VendorQueryType;
    outcome: StatementOutcome;
  }): void {
    this.metrics.incrementCount({ queryType, outcome });
  }

  /**
   * Report an attempt that failed and was raised to the caller.
   *
   * Warn, not error, and the cause off the `error` field — the same two rules
   * as the vendor-log policy in ./logging.ts.
   *
   * The level is the substantive half. This layer does not know the outcome: a
   * read's translated error is reported at the request boundary, and an insert
   * is issued from a job the queue retries, which logs its own error and counts
   * what it drops if it ever truly gives up. Claiming a verdict here made
   * recovered work read as lost work — 17k records a day against zero jobs
   * actually dropped.
   *
   * The failure is still counted: {@link outcome} runs at every call site, and
   * a rate is what the alerting is built on.
   */
  failure({
    operation,
    error,
    durationMs,
    params,
  }: {
    operation: StatementOperation;
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

  success({
    operation,
    durationMs,
    params,
  }: {
    operation: StatementOperation;
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

  /**
   * Report an attempt that failed and is about to be retried.
   *
   * For a transient failure that later succeeds this is the ONLY line emitted —
   * {@link failure} never runs — so the cluster belongs here too, or a
   * recovered failure on a customer's private instance is indistinguishable
   * from one on the shared cluster.
   *
   * Written to the notice sink, which is guarded, so this needs no `catch` of
   * its own.
   */
  retryNotice({
    operation,
    attempt,
    maxAttempts,
    delayMs,
    error,
    level,
  }: {
    operation: StatementOperation;
    attempt: number;
    maxAttempts: number;
    delayMs: number;
    error: unknown;
    level: RetryAttemptNotice["level"];
  }): void {
    this.noticeLogger[level](
      {
        source: "clickhouse",
        cluster: this.cluster,
        operation,
        attempt: attempt + 1,
        maxRetries: maxAttempts - 1,
        delayMs: Math.round(delayMs),
        [RETRY_CAUSE_FIELD]: error,
      },
      `Transient ClickHouse ${operation} error, retrying`,
    );
  }
}
