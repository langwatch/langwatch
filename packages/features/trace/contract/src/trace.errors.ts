import { HandledError, NotFoundError, remediation } from "@langwatch/handled-error";

export class TraceNotFoundError extends NotFoundError {
  declare readonly code: "trace_not_found";

  constructor(
    readonly traceId: string,
    options: { reasons?: readonly Error[] } = {},
  ) {
    super("trace_not_found", "Trace", traceId, {
      meta: { traceId },
      ...remediation("trace_not_found"),
      ...options,
    });
    this.name = "TraceNotFoundError";
  }
}

export class FilterParseError extends HandledError {
  declare readonly code: "filter_parse_error";

  constructor(message: string, position?: number) {
    super("filter_parse_error", message, {
      httpStatus: 422,
      meta: {
        ...(position !== void 0 ? { position } : {}),
        expected: message,
      },
      tips: [
        "Check the filter syntax near the indicated position; filters are field:value pairs combined with AND/OR",
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
      tips: ["Use one of the fields listed in meta.knownFields", "Field names are case-sensitive"],
    });
    this.name = "FilterFieldUnknownError";
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

/**
 * This process refused the statement itself: concurrency slots all taken and the wait queue
 * full, so it never reached ClickHouse.
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
