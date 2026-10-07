import { ATTR_KEYS } from "@langwatch/span-normalisation";

import type { TraceSummaryData } from "./trace-projection.ts";
import { type NormalizedSpan, NormalizedStatusCode as StatusCode } from "./trace.spans.ts";

/**
 * Extracts and accumulates error/OK status from individual spans
 * into the trace-level summary.
 */
export function extractSpanStatus(span: NormalizedSpan): {
  hasError: boolean;
  hasOK: boolean;
  errorMessage: string | null;
} {
  const attrs = span.spanAttributes;
  const hasOK = span.statusCode === StatusCode.OK;
  let hasError = span.statusCode === StatusCode.ERROR;

  let errorMessage = extractReportedErrorMessage(span);
  if (errorMessage !== null) {
    hasError = true;
  }

  // 3. span-level statusMessage (HTTP status fallback)
  const isErrorStatus = span.statusCode === StatusCode.ERROR;
  if (!errorMessage && isErrorStatus && span.statusMessage) {
    errorMessage = span.statusMessage;
  }

  if (!hasError) {
    const flag = attrs[ATTR_KEYS.ERROR_HAS_ERROR] ?? attrs[ATTR_KEYS.SPAN_ERROR_HAS_ERROR];
    hasError = flag === true || flag === "true";
  }

  return { hasError, hasOK, errorMessage };
}

// Exception event message (actionable) before span statusMessage (summarized).
// Avoids losing detail at trace level. See span.mapper #78.
function extractReportedErrorMessage(span: NormalizedSpan): string | null {
  const exceptions = span.events?.filter((e) => e.name === "exception") ?? [];
  const latest = exceptions[exceptions.length - 1];
  const fromEvent = latest?.attributes?.["exception.message"];
  if (typeof fromEvent === "string" && fromEvent.length > 0) {
    return fromEvent;
  }

  const attrs = span.spanAttributes;
  const fromAttribute = attrs[ATTR_KEYS.EXCEPTION_MESSAGE] ?? attrs[ATTR_KEYS.ERROR_MESSAGE];
  if (typeof fromAttribute === "string" && fromAttribute.length > 0) {
    return fromAttribute;
  }

  return null;
}

export function accumulateSpanStatus({
  state,
  span,
}: {
  state: TraceSummaryData;
  span: NormalizedSpan;
}): {
  containsErrorStatus: boolean;
  containsOKStatus: boolean;
  errorMessage: string | null;
} {
  const info = extractSpanStatus(span);

  return {
    containsErrorStatus: state.containsErrorStatus || info.hasError,
    containsOKStatus: state.containsOKStatus || info.hasOK,
    errorMessage: state.errorMessage ?? info.errorMessage,
  };
}
