/**
 * The four ClickHouse query refusals a caller can act on.
 *
 * Moved here with the LangWatchQL executor and the read-path translation that
 * raises them: they describe a QUERY's fate — it timed out, it exceeded the
 * memory ceiling, it would have read past the scan ceiling, or the cluster was
 * not reachable — and every door that raises them now runs over the analytics
 * ClickHouse seam. The trace-shaped refusals beside them (a trace that is not
 * there, a range that is too wide, a page too deep) stayed with the trace
 * vertical, because those are facts about a trace read rather than about a
 * statement.
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
