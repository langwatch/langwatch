import { HandledError } from "@langwatch/handled-error";

export class TraceNotFoundError extends Error {
  constructor(readonly traceId: string) {
    super(`Trace ${traceId} was not found`);
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
