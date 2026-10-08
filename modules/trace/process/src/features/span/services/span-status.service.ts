import {
  accumulateSpanStatus,
  extractSpanStatus,
  type NormalizedSpan,
  type TraceSummaryData,
} from "@langwatch/trace-contract";

/**
 * Extracts and accumulates error/OK status from individual spans
 * into the trace-level summary. The rules are the contract's.
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
    return extractSpanStatus(span);
  }

  accumulateStatus({ state, span }: { state: TraceSummaryData; span: NormalizedSpan }): {
    containsErrorStatus: boolean;
    containsOKStatus: boolean;
    errorMessage: string | null;
  } {
    return accumulateSpanStatus({ state, span });
  }
}
