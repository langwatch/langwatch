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
      if (span.statusMessage) errorMessage = span.statusMessage;
    }

    if (!errorMessage) {
      const msg =
        attrs[ATTR_KEYS.ERROR_MESSAGE] ?? attrs[ATTR_KEYS.EXCEPTION_MESSAGE];
      if (typeof msg === "string") {
        errorMessage = msg;
        hasError = true;
      }
    }

    if (!hasError) {
      const flag =
        attrs[ATTR_KEYS.ERROR_HAS_ERROR] ??
        attrs[ATTR_KEYS.SPAN_ERROR_HAS_ERROR];
      if (flag === true || flag === "true") hasError = true;
    }

    if (!errorMessage && span.events?.length) {
      const ex = span.events.find((e) => e.name === "exception");
      if (ex) {
        hasError = true;
        const msg = ex.attributes?.["exception.message"];
        if (typeof msg === "string") errorMessage = msg;
      }
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
