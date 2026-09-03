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
