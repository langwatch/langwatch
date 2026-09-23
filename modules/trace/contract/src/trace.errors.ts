import { HandledError, NotFoundError, remediation } from "@langwatch/handled-error";

import type { AiActionErrorDetails } from "./trace-ai-query.ts";
import { FILTER_TOO_COMPLEX_MESSAGE } from "./trace-query-analysis.ts";

/** The configured model provider did not produce a usable trace query. */
export class AiQueryProviderError extends HandledError {
  declare readonly code: "ai_query_provider_error";

  constructor(details: AiActionErrorDetails = {}) {
    super("ai_query_provider_error", "The model did not produce a usable trace query.", {
      httpStatus: 502,
      fault: "provider",
      meta: { ...details },
    });
    this.name = "AiQueryProviderError";
  }
}

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

/** A trace ID prefix a caller sent matches more than one trace. */
export class TraceIdAmbiguousError extends HandledError {
  declare readonly code: "trace_id_ambiguous";

  constructor(
    readonly prefix: string,
    readonly candidateTraceIds: readonly string[],
  ) {
    super("trace_id_ambiguous", `Trace ID prefix "${prefix}" is ambiguous.`, {
      httpStatus: 409,
      meta: { candidateTraceIds },
    });
    this.name = "TraceIdAmbiguousError";
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
      ...remediation("filter_parse_error"),
    });
    this.name = "FilterParseError";
  }
}

/**
 * A filter past the node ceiling. `meta.maxNodes` has a named consumer: an
 * agent narrowing a filter needs the ceiling to know how far to cut, and the
 * client checks the same number before sending.
 */
export class FilterTooComplexError extends HandledError {
  declare readonly code: "filter_too_complex";

  constructor({ maxNodes }: { readonly maxNodes: number }) {
    super("filter_too_complex", FILTER_TOO_COMPLEX_MESSAGE, {
      httpStatus: 422,
      fault: "customer",
      meta: { maxNodes },
      ...remediation("filter_too_complex"),
    });
    this.name = "FilterTooComplexError";
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
 * A trace- or thread-id array above the plan's bound. Refused rather than
 * silently dropped, so a caller paging through a large export learns the
 * bound at the first oversized request.
 */
export class TraceIdsTooManyError extends HandledError {
  declare readonly code: "trace_ids_too_many";

  constructor(maxIds: number) {
    super(
      "trace_ids_too_many",
      `At most ${maxIds} trace or thread ids can be read at once under this plan. Split the request into smaller batches.`,
      {
        httpStatus: 422,
        fault: "customer",
        meta: { maxIds },
      },
    );
    this.name = "TraceIdsTooManyError";
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
export class TraceIngestionUnavailableError extends HandledError {
  constructor() {
    super("service_unavailable", "Trace ingestion is not available on this deployment.", {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "TraceIngestionUnavailableError";
  }
}

/**
 * A caller who cannot read captured content asked for the values behind an
 * attribute key — the gen_ai conventions put prompts and completions in
 * exactly those namespaces. The key itself stays in the discovery payload.
 */
export class TraceAttributeValuesWithheldError extends HandledError {
  declare readonly code: "trace_attribute_values_withheld";

  constructor(field: string) {
    super(
      "trace_attribute_values_withheld",
      "Attribute values are not listed to a caller who cannot read the content behind them",
      {
        httpStatus: 403,
        fault: "customer",
        meta: { field },
        tips: [
          "Two rules reach this: the project hides captured input or output from you, or an attribute policy restricts this key to an audience you are not in",
          "Facet a named field instead, for example `model`, `status` or `evaluator`",
          "GET /api/v1/traces/facets with no field lists every facet this project has",
        ],
      },
    );
    this.name = "TraceAttributeValuesWithheldError";
  }
}

/**
 * `traces.aiQuery`/`traces.aiAction` declare the merged-in `traces` shape,
 * but no model-invocation capability is wired into the transport yet — see
 * the merge-traces-v2 handoff.
 */
export class TraceAiQueryUnavailableError extends HandledError {
  constructor() {
    super("service_unavailable", "AI-assisted trace search is not available on this deployment.", {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "TraceAiQueryUnavailableError";
  }
}

/** A capability this deployment did not compose, refused by name at the call. */
export class TraceCapabilityUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(processName: string, capability: string) {
    super("service_unavailable", "This part of the product is not available on this deployment", {
      httpStatus: 503,
      fault: "platform",
      meta: { process: processName, capability },
    });
    this.name = "TraceCapabilityUnavailableError";
  }
}
