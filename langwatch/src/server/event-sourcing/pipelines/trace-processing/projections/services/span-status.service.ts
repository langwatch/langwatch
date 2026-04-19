import { ATTR_KEYS } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { NormalizedSpan } from "../../schemas/spans";
import { NormalizedStatusCode as StatusCode } from "../../schemas/spans";

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
    let hasError = false;
    let hasOK = false;
    let errorMessage: string | null = null;

    if (span.statusCode === StatusCode.OK) hasOK = true;
    else if (span.statusCode === StatusCode.ERROR) {
      hasError = true;
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
    if (span.events?.length) {
      const exceptions = span.events.filter((e) => e.name === "exception");
      if (exceptions.length > 0) {
        const latest = exceptions[exceptions.length - 1];
        const msg = latest?.attributes?.["exception.message"];
        if (typeof msg === "string" && msg.length > 0) {
          errorMessage = msg;
          hasError = true;
        }
      }
    }

    // 2. span-level exception.message / error.message attribute
    if (!errorMessage) {
      const msg =
        attrs[ATTR_KEYS.EXCEPTION_MESSAGE] ?? attrs[ATTR_KEYS.ERROR_MESSAGE];
      if (typeof msg === "string" && msg.length > 0) {
        errorMessage = msg;
        hasError = true;
      }
    }

    // 3. span-level statusMessage (HTTP status fallback)
    if (!errorMessage && span.statusCode === StatusCode.ERROR && span.statusMessage) {
      errorMessage = span.statusMessage;
    }

    if (!hasError) {
      const flag =
        attrs[ATTR_KEYS.ERROR_HAS_ERROR] ??
        attrs[ATTR_KEYS.SPAN_ERROR_HAS_ERROR];
      if (flag === true || flag === "true") hasError = true;
    }

    return { hasError, hasOK, errorMessage };
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
