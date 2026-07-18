// Wired at the resilient ClickHouse client (`app-layer/clients/clickhouse/
// resilient-client.ts`), which translates raw driver errors into these typed
// errors after retries are exhausted.
import { HandledError, NotFoundError } from "~/server/app-layer/handled-error";
import { docsUrl } from "~/utils/docsUrl";

export class TraceNotFoundError extends NotFoundError {
  declare readonly code: "trace_not_found";

  constructor(traceId: string, options: { reasons?: readonly Error[] } = {}) {
    super("trace_not_found", "Trace", traceId, {
      meta: { traceId },
      tips: [
        "Check the trace id — traces are deleted after the retention window",
        "If you just sent this trace, retry in a few seconds — ingestion is asynchronous",
      ],
      docsUrl: docsUrl("/platform/data-retention"),
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
      tips: [
        "Check the span id — spans are deleted with their trace after the retention window",
      ],
      docsUrl: docsUrl("/platform/data-retention"),
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
    super(
      "query_timeout",
      `Query timed out (${(durationMs / 1000).toFixed(1)}s)`,
      {
        httpStatus: 504,
        meta: { durationMs, ...(hint ? { hint } : {}) },
        tips: [
          ...(hint ? [hint] : []),
          "Narrow the time range",
          "Add filters to reduce the amount of data scanned",
        ],
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
        tips: [
          "Narrow the time range",
          "Add filters to reduce the amount of data scanned",
          "Request fewer attribute/metadata fields",
        ],
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
      tips: [
        "Check the filter syntax near the indicated position — filters are field:value pairs combined with AND/OR",
      ],
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
      tips: [
        "Use one of the fields listed in meta.knownFields",
        "Field names are case-sensitive",
      ],
    });
    this.name = "FilterFieldUnknownError";
  }
}

export class TimeRangeTooWideError extends HandledError {
  declare readonly code: "time_range_too_wide";

  constructor(maxDays: number) {
    super(
      "time_range_too_wide",
      `Maximum ${maxDays} days. Narrow time range.`,
      {
        httpStatus: 422,
        meta: { maxDays },
        tips: [
          `Narrow the time range to ${maxDays} days or less`,
          "Query in smaller windows and paginate through the results",
        ],
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
      tips: [
        "This is a temporary platform issue — retry in a few seconds",
        "If it persists, check the LangWatch status page or contact support",
      ],
      reasons: options.reasons,
    });
    this.name = "ClickHouseUnavailableError";
  }
}
