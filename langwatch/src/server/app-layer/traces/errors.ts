// Wired at the resilient ClickHouse client (`app-layer/clients/clickhouse/
// resilient-client.ts`), which translates raw driver errors into these typed
// errors after retries are exhausted.
//
// Tips/docs links come from the central registry (`../error-remediation`) —
// add copy there, not inline.
import { HandledError, NotFoundError } from "@langwatch/handled-error";

import { remediation } from "../error-remediation";

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

  constructor(
    durationMs: number,
    options: { hint?: string; reasons?: readonly Error[] } = {},
  ) {
    const { hint, reasons } = options;
    const base = remediation("query_timeout");
    super(
      "query_timeout",
      `Query timed out (${(durationMs / 1000).toFixed(1)}s)`,
      {
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
      },
    );
    this.name = "QueryTimeoutError";
  }
}

export class QueryMemoryExceededError extends HandledError {
  declare readonly code: "query_memory_exceeded";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super(
      "query_memory_exceeded",
      "Query exceeded its memory limit and was aborted",
      {
        httpStatus: 422,
        ...remediation("query_memory_exceeded"),
        reasons: options.reasons,
      },
    );
    this.name = "QueryMemoryExceededError";
  }
}

export class FilterParseError extends HandledError {
  declare readonly code: "filter_parse_error";

  constructor(message: string, position?: number) {
    super("filter_parse_error", message, {
      httpStatus: 422,
      meta: {
        ...(position !== undefined ? { position } : {}),
        expected: message,
      },
      ...remediation("filter_parse_error"),
    });
    this.name = "FilterParseError";
  }
}

export class FilterFieldUnknownError extends HandledError {
  declare readonly code: "filter_field_unknown";

  constructor(field: string, knownFields: string[]) {
    super("filter_field_unknown", `Unknown field: @${field}`, {
      httpStatus: 422,
      meta: { field, knownFields },
      ...remediation("filter_field_unknown"),
    });
    this.name = "FilterFieldUnknownError";
  }
}

export class TimeRangeTooWideError extends HandledError {
  declare readonly code: "time_range_too_wide";

  constructor(maxDays: number) {
    const base = remediation("time_range_too_wide");
    super(
      "time_range_too_wide",
      `Maximum ${maxDays} days. Narrow time range.`,
      {
        httpStatus: 422,
        meta: { maxDays },
        tips: [
          `Narrow the time range to ${maxDays} days or less`,
          ...(base.tips ?? []),
        ],
        ...(base.docsUrl ? { docsUrl: base.docsUrl } : {}),
      },
    );
    this.name = "TimeRangeTooWideError";
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
