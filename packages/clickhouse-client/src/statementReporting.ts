/**
 * Everything the vendor-client policy says about a statement — split from
 * ./vendorClient.ts, which decides what happens to it. Ports are wrapped once
 * so a catch-site throw from a counter or log sink never masks the real error.
 */

import { createHash } from "node:crypto";

import { createWarnThrottle, type WarnThrottle } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import { QUERY_CAUSE_FIELD, quietly, RETRY_CAUSE_FIELD } from "./resilience.ts";
import type { RetryAttemptNotice } from "./retry.ts";
import {
  extractQueryPreview,
  extractRawQuery,
  safeQueryMeta,
  type VendorQueryType,
} from "./statementShape.ts";

/**
 * How a statement ended, as the metric counts it. `inband_error` is a
 * transport-level success whose streamed body carried the server's exception
 * — its own outcome so one query is never counted under two terminal ones.
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
  incrementCount(input: { queryType: VendorQueryType; outcome: StatementOutcome }): void;
}

/** The subset of a structured logger this package writes through. */
export interface StatementLogSink {
  debug(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

/**
 * A view of `metrics` that cannot throw. Written out rather than derived by
 * walking keys: a host may pass a class instance whose methods live on the
 * prototype, and reflecting over own properties would silently guard nothing.
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

/** Whether the caller set `SKIP_COLD_SCAN_CHECK`: a read declared to walk every partition. */
function declaresFullScan(params: unknown): boolean {
  return (
    typeof params === "object" &&
    params !== null &&
    "SKIP_COLD_SCAN_CHECK" in params &&
    params.SKIP_COLD_SCAN_CHECK === true
  );
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

/** How long a cold-scan warning for one query shape stays quiet after it is logged. */
const COLD_SCAN_WARN_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Replaces each string literal with `?` and drops comments outside quoted identifiers, in one
 * linear pass (a backtracking regex is quadratic), so no quote or comment swallows later SQL.
 */
function withoutLiteralsOrComments(query: string): string {
  let out = "";
  let i = 0;
  while (i < query.length) {
    const skipped = skipLiteralOrComment({ query, i });
    if (skipped === null) {
      out += query[i];
      i++;
    } else {
      out += skipped.replacement;
      i = skipped.next;
    }
  }

  return out;
}

/** What a literal or comment starting at `i` becomes, and where the SQL resumes; null if none. */
function skipLiteralOrComment({
  query,
  i,
}: {
  query: string;
  i: number;
}): { replacement: string; next: number } | null {
  const ch = query[i];
  if (ch === "'") return { replacement: "?", next: endOfQuoted({ query, i: i + 1, quote: "'" }) };
  if (ch === '"' || ch === "`") {
    const next = endOfQuoted({ query, i: i + 1, quote: ch });
    return { replacement: query.slice(i, next), next };
  }
  const pair = query.slice(i, i + 2);
  if (pair === "--") {
    const end = query.indexOf("\n", i);
    return { replacement: "", next: end === -1 ? query.length : end };
  }
  if (pair === "/*") {
    const end = query.indexOf("*/", i + 2);
    return { replacement: " ", next: end === -1 ? query.length : end + 2 };
  }

  return null;
}

/** The index just past the `quote` closing a run starting at `i`; a doubled quote stays in. */
function endOfQuoted({ query, i, quote }: { query: string; i: number; quote: string }): number {
  let at = i;
  while (at < query.length) {
    if (query[at] === "\\") at += 2;
    else if (query[at] !== quote) at += 1;
    else if (query[at + 1] === quote) at += 2;
    else return at + 1;
  }

  return at;
}

/**
 * A query with its literals and layout removed, hashed, so the same statement run for another
 * tenant, time window or limit is one key. The warning is about the statement's form.
 */
function queryShapeOf(rawQuery: string): string {
  const shape = withoutLiteralsOrComments(rawQuery)
    .replace(/\b\d+(?:\.\d+)?\b/g, "?")
    .replace(/\s+/g, " ")
    .trim();

  return createHash("sha256").update(shape).digest("base64url");
}

export interface StatementReporterOptions {
  /** Epoch milliseconds; injectable so a test steps the cold-scan quiet window. */
  now?: (() => number) | undefined;
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
  private readonly now: () => number;
  /** One cold-scan warning per query shape per interval; per reporter, so tests stay apart. */
  private readonly coldScanThrottle: WarnThrottle = createWarnThrottle(COLD_SCAN_WARN_INTERVAL_MS);

  constructor({
    now = () => nowInstant().epochMilliseconds,
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
    this.now = now;
  }

  /** Null while the shape is quiet; otherwise how many warnings it held back since the last. */
  private claimColdScanWarning(rawQuery: string): { suppressedSincePrevious: number } | null {
    const suppressed = this.coldScanThrottle.claim({
      key: queryShapeOf(rawQuery),
      now: this.now(),
    });

    return suppressed === undefined ? null : { suppressedSincePrevious: suppressed };
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
   * Count an outcome with no new duration sample. The in-band case only:
   * transport outcome plus one histogram observation was already recorded
   * when the query resolved, so a second duration would double-count it.
   */
  count({ queryType, outcome }: { queryType: VendorQueryType; outcome: StatementOutcome }): void {
    this.metrics.incrementCount({ queryType, outcome });
  }

  /**
   * Report a failed attempt raised to the caller. Warn, not error: this
   * layer can't know the outcome (a retried job may still succeed) —
   * claiming a verdict here once read 17k recovered records/day as loss.
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
          // Which ClickHouse refused it — an org may be routed to its own
          // cluster, so without this a dedicated-instance rejection reads as
          // the shared cluster. On 2026-08-13 that ambiguity took an
          // afternoon to attribute a 3-hour saturation.
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
      this.noticeLogger.error({ loggingError }, "Failed to log ClickHouse query failure");
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
        operation === "query" && !declaresFullScan(params)
          ? this.detectColdScan(extractRawQuery(params))
          : null;

      const coldScanClaim =
        coldScanTable !== null ? this.claimColdScanWarning(extractRawQuery(params)) : null;

      if (coldScanTable !== null && coldScanClaim !== null) {
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
            suppressedSincePrevious: coldScanClaim.suppressedSincePrevious,
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
      this.noticeLogger.error({ loggingError }, "Failed to log ClickHouse query success");
    }
  }

  /**
   * Report an attempt that failed and is about to be retried. The only
   * reporting method with no `catch`, deliberately: this already writes to
   * the notice sink, so a fallback would report a broken sink through itself.
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
