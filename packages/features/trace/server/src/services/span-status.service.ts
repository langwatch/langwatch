import { ATTR_KEYS, type TraceSummaryData } from "@langwatch/trace-contract";
import { NormalizedStatusCode as StatusCode, type NormalizedSpan } from "@langwatch/trace-contract";

/**
 * Extracts and accumulates error/OK status from individual spans
 * into the trace-level summary.
 */
export class SpanStatusService {
  private constructor() {}

  static create(): SpanStatusService {
    return new SpanStatusService();
  }

  extractStatus(span: NormalizedSpan): {
    hasError: boolean;
    hasOK: boolean;
    errorMessage: string | null;
  } {
    const attrs = span.spanAttributes;
    const hasOK = span.statusCode === StatusCode.OK;
    let hasError = span.statusCode === StatusCode.ERROR;

    let errorMessage = SpanStatusService.reportedErrorMessage(span);
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

  // Priority (first hit wins) mirrors the span.mapper renderer fix
  // for finding #78 — OTel exception events carry the actionable text
  // (e.g. upstream gateway "provider X not bound, try Y") which span
  // statusMessage often collapses to a short HTTP-status summary like
  // "Bad Request". Without this ordering the trace-level errorMessage
  // that the Thread tab reads (`trace.error.message`) loses every
  // actionable detail Lane A attaches at the event level.
  //
  // 1. newest exception event's exception.message
  // 2. span-level exception.message / error.message attribute
  private static reportedErrorMessage(span: NormalizedSpan): string | null {
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

  accumulateStatus({ state, span }: { state: TraceSummaryData; span: NormalizedSpan }): {
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
