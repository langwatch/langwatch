import { DomainError, NotFoundError } from "~/server/app-layer/domain-error";

export class TraceNotFoundError extends NotFoundError {
  declare readonly kind: "trace_not_found";

  constructor(traceId: string, options: { reasons?: readonly Error[] } = {}) {
    super("trace_not_found", "Trace", traceId, {
      meta: { traceId },
      ...options,
    });
    this.name = "TraceNotFoundError";
  }
}

export class SpanNotFoundError extends NotFoundError {
  declare readonly kind: "span_not_found";

  constructor(spanId: string, options: { reasons?: readonly Error[] } = {}) {
    super("span_not_found", "Span", spanId, {
      meta: { spanId },
      ...options,
    });
    this.name = "SpanNotFoundError";
  }
}

export class QueryTimeoutError extends DomainError {
  declare readonly kind: "query_timeout";

  constructor(durationMs: number, hint?: string) {
    super("query_timeout", `Query timed out (${(durationMs / 1000).toFixed(1)}s)`, {
      httpStatus: 504,
      meta: { durationMs, ...(hint ? { hint } : {}) },
    });
    this.name = "QueryTimeoutError";
  }
}

export class FilterParseError extends DomainError {
  declare readonly kind: "filter_parse_error";

  constructor(message: string, position?: number) {
    super("filter_parse_error", message, {
      httpStatus: 422,
      meta: { ...(position !== undefined ? { position } : {}), expected: message },
    });
    this.name = "FilterParseError";
  }
}

export class FilterFieldUnknownError extends DomainError {
  declare readonly kind: "filter_field_unknown";

  constructor(field: string, knownFields: string[]) {
    super("filter_field_unknown", `Unknown field: @${field}`, {
      httpStatus: 422,
      meta: { field, knownFields },
    });
    this.name = "FilterFieldUnknownError";
  }
}

export class TimeRangeTooWideError extends DomainError {
  declare readonly kind: "time_range_too_wide";

  constructor(maxDays: number) {
    super("time_range_too_wide", `Maximum ${maxDays} days. Narrow time range.`, {
      httpStatus: 422,
      meta: { maxDays },
    });
    this.name = "TimeRangeTooWideError";
  }
}

export class ClickHouseUnavailableError extends DomainError {
  declare readonly kind: "clickhouse_unavailable";

  constructor() {
    super("clickhouse_unavailable", "Database temporarily unavailable", {
      httpStatus: 503,
    });
    this.name = "ClickHouseUnavailableError";
  }
}
