/**
 * ClickHouse query refusals: timeout, memory, scan ceiling, cluster unavailable—
 * actionable by callers.
 */
import { HandledError, remediation } from "@langwatch/handled-error";

export class QueryTimeoutError extends HandledError {
  declare readonly code: "query_timeout";

  constructor(durationMs: number, options: { hint?: string; reasons?: readonly Error[] } = {}) {
    const { hint, reasons } = options;
    const base = remediation("query_timeout");
    super("query_timeout", `Query timed out (${(durationMs / 1000).toFixed(1)}s)`, {
      httpStatus: 504,
      // A 504 from our own datastore is our problem, not the caller's —
      // same reasoning as `ClickHouseUnavailableError` below. `fault`
      // defaults to `"customer"`, which would log this at warn and (since
      // it now drives evaluation skip-vs-error) let a slow-query regression
      // surface as a benign customer skip.
      fault: "platform",
      meta: { durationMs, ...(hint ? { hint } : {}) },
      // The call-site hint (when given) leads; registry tips follow.
      tips: [...(hint ? [hint] : []), ...(base.tips ?? [])],
      ...(base.docsUrl ? { docsUrl: base.docsUrl } : {}),
      reasons,
    });
    this.name = "QueryTimeoutError";
  }
}

export class QueryMemoryExceededError extends HandledError {
  declare readonly code: "query_memory_exceeded";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super("query_memory_exceeded", "Query exceeded its memory limit and was aborted", {
      httpStatus: 422,
      ...remediation("query_memory_exceeded"),
      reasons: options.reasons,
    });
    this.name = "QueryMemoryExceededError";
  }
}

/**
 * Query exceeded scan ceiling (max_rows_to_read / max_bytes_to_read)—
 * distinct from memory, same remedy.
 */
export class QueryScanLimitExceededError extends HandledError {
  declare readonly code: "query_scan_limit_exceeded";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super(
      "query_scan_limit_exceeded",
      "Query would read more data than its scan limit allows and was aborted",
      {
        httpStatus: 422,
        ...remediation("query_scan_limit_exceeded"),
        reasons: options.reasons,
      },
    );
    this.name = "QueryScanLimitExceededError";
  }
}

export class ClickHouseUnavailableError extends HandledError {
  declare readonly code: "clickhouse_unavailable";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super("clickhouse_unavailable", "Database temporarily unavailable", {
      httpStatus: 503,
      // Our datastore being down is an incident, not caller error — keep it
      // at error level in the logs.
      fault: "platform",
      ...remediation("clickhouse_unavailable"),
      reasons: options.reasons,
    });
    this.name = "ClickHouseUnavailableError";
  }
}

/**
 * A series asked for percentage mode on a per-entity measurement (average per
 * user, sum per thread): the filter decides which entities exist, so the two
 * halves cannot be divided bucket by bucket. No `meta`: the evaluator logs it.
 */
export class SeriesPercentageUnsupportedError extends HandledError {
  declare readonly code: "analytics_series_percentage_unsupported";

  constructor() {
    super(
      "analytics_series_percentage_unsupported",
      "This series cannot be shown as a percentage.",
      { httpStatus: 400 },
    );
    this.name = "SeriesPercentageUnsupportedError";
  }
}

/** Matched on `code`, not `instanceof`: the error may arrive re-hydrated from a payload. */
export function isSeriesPercentageUnsupported(error: unknown): boolean {
  return (
    error instanceof Object &&
    "code" in error &&
    error.code === "analytics_series_percentage_unsupported"
  );
}
