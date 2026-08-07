import { ATTR_KEYS } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { NormalizedSpan } from "../../schemas/spans";
import { NormalizedStatusCode as StatusCode } from "../../schemas/spans";

function hasOKStatus(span: NormalizedSpan): boolean {
  return span.statusCode === StatusCode.OK;
}

// 1. newest exception event's exception.message
function errorMessageFromLatestException(span: NormalizedSpan): string | null {
  const exceptions = (span.events ?? []).filter((e) => e.name === "exception");
  if (exceptions.length === 0) return null;
  const latest = exceptions[exceptions.length - 1];
  const msg = latest?.attributes?.["exception.message"];
  return typeof msg === "string" && msg.length > 0 ? msg : null;
}

// 2. span-level exception.message / error.message attribute
function errorMessageFromSpanAttributes(
  attrs: NormalizedSpan["spanAttributes"],
): string | null {
  const msg =
    attrs[ATTR_KEYS.EXCEPTION_MESSAGE] ?? attrs[ATTR_KEYS.ERROR_MESSAGE];
  return typeof msg === "string" && msg.length > 0 ? msg : null;
}

// 3. span-level statusMessage (HTTP status fallback)
function errorMessageFromStatusMessage(span: NormalizedSpan): string | null {
  return span.statusCode === StatusCode.ERROR && span.statusMessage
    ? span.statusMessage
    : null;
}

function hasErrorFlagAttribute(
  attrs: NormalizedSpan["spanAttributes"],
): boolean {
  const flag =
    attrs[ATTR_KEYS.ERROR_HAS_ERROR] ?? attrs[ATTR_KEYS.SPAN_ERROR_HAS_ERROR];
  return flag === true || flag === "true";
}

/**
 * Extracts and accumulates error/OK status from individual spans
 * into the trace-level summary.
 */
export class SpanStatusService {
  extractStatus(span: NormalizedSpan): {
    hasError: boolean;
    hasOK: boolean;
    errorMessage: string | null;
  } {
    const attrs = span.spanAttributes;

    // Priority (first hit wins) mirrors the span.mapper renderer fix
    // for finding #78 — OTel exception events carry the actionable text
    // (e.g. upstream gateway "provider X not bound, try Y") which span
    // statusMessage often collapses to a short HTTP-status summary like
    // "Bad Request". Without this ordering the trace-level errorMessage
    // that the Thread tab reads (`trace.error.message`) loses every
    // actionable detail Lane A attaches at the event level.
    const errorMessage =
      errorMessageFromLatestException(span) ??
      errorMessageFromSpanAttributes(attrs) ??
      errorMessageFromStatusMessage(span);

    const hasError =
      span.statusCode === StatusCode.ERROR ||
      errorMessage !== null ||
      hasErrorFlagAttribute(attrs);

    return { hasError, hasOK: hasOKStatus(span), errorMessage };
  }

  accumulateStatus({
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
    const info = this.extractStatus(span);
    return {
      containsErrorStatus: state.containsErrorStatus || info.hasError,
      containsOKStatus: state.containsOKStatus || info.hasOK,
      errorMessage: state.errorMessage ?? info.errorMessage,
    };
  }
}
