// Wired at the resilient ClickHouse client assembly (`server/clickhouse/
// managedClient.ts`), which translates raw driver errors into these typed
// errors after retries are exhausted.
//
// Tips/docs links come from the central registry (`@langwatch/handled-error`) —
// add copy there, not inline.
import { HandledError, NotFoundError, remediation } from "@langwatch/handled-error";


export class TraceNotFoundError extends NotFoundError {
  declare readonly code: "trace_not_found";

  constructor(traceId: string, options: { reasons?: readonly Error[] } = {}) {
    super("trace_not_found", "Trace", traceId, {
      meta: { traceId },
      ...remediation("trace_not_found"),
      ...options,
    });
    this.name = "TraceNotFoundError";
  }
}

export class SpanNotFoundError extends NotFoundError {
  declare readonly code: "span_not_found";

  constructor(spanId: string, options: { reasons?: readonly Error[] } = {}) {
    super("span_not_found", "Span", spanId, {
      meta: { spanId },
      ...remediation("span_not_found"),
      ...options,
    });
    this.name = "SpanNotFoundError";
  }
}

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
 * The query would have read past a scan ceiling (`max_rows_to_read` /
 * `max_bytes_to_read`) and was aborted rather than truncated.
 *
 * Distinct from {@link QueryMemoryExceededError}: a query can sit well inside
 * the memory ceiling and still be refused for the volume it would touch, and
 * the remedy is the same shape but the cause is not. `customer` fault — the
 * ceiling is deliberate and the caller narrows the query to clear it.
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

export class TimeRangeTooWideError extends HandledError {
  declare readonly code: "time_range_too_wide";

  constructor(maxDays: number) {
    const base = remediation("time_range_too_wide");
    super("time_range_too_wide", `Maximum ${maxDays} days. Narrow time range.`, {
      httpStatus: 422,
      meta: { maxDays },
      tips: [`Narrow the time range to ${maxDays} days or less`, ...(base.tips ?? [])],
      ...(base.docsUrl ? { docsUrl: base.docsUrl } : {}),
    });
    this.name = "TimeRangeTooWideError";
  }
}

export class PageTooDeepError extends HandledError {
  declare readonly code: "page_too_deep";

  constructor(maxRows: number) {
    const base = remediation("page_too_deep");
    super(
      "page_too_deep",
      `Pages past the first ${maxRows} rows cannot be opened by number. Narrow the range, or page forward.`,
      {
        httpStatus: 422,
        meta: { maxRows },
        ...(base.tips ? { tips: base.tips } : {}),
        ...(base.docsUrl ? { docsUrl: base.docsUrl } : {}),
      },
    );
    this.name = "PageTooDeepError";
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
 * This process refused the statement itself: its concurrency slots were all
 * taken and its wait queue was full, so the statement never reached ClickHouse.
 *
 * Distinct from {@link ClickHouseUnavailableError} on purpose, even though both
 * are a 503. "The database is down" and "we declined to add to a load we are
 * already struggling with" call for different responses, and only one of them
 * is fixed by looking at ClickHouse. The count lives in
 * `clickhouse_statements_shed_total`.
 */
export class ClickHouseOverloadedError extends HandledError {
  declare readonly code: "clickhouse_overloaded";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super("clickhouse_overloaded", "Too many queries in flight", {
      httpStatus: 503,
      // Shedding is the platform protecting itself, not a bad request.
      fault: "platform",
      ...remediation("clickhouse_overloaded"),
      reasons: options.reasons,
    });
    this.name = "ClickHouseOverloadedError";
  }
}
