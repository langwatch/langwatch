import {
  type NormalizedSpan,
  type ResolvedTraceName,
  resolveTraceNameFromSpan,
  type TraceSummaryData,
} from "@langwatch/trace-contract";

/**
 * Owns the precedence rules for a trace's user-facing name and its canonical
 * root-span metadata; the rules are the contract's `resolveTraceNameFromSpan`.
 */
export class TraceNameResolutionService {
  private constructor() {}

  static create(): TraceNameResolutionService {
    return new TraceNameResolutionService();
  }

  resolveFromSpan({
    state,
    span,
  }: {
    state: TraceSummaryData;
    span: NormalizedSpan;
  }): ResolvedTraceName {
    return resolveTraceNameFromSpan({ state, span });
  }
}
