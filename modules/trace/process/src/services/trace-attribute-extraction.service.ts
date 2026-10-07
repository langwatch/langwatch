import { extractTraceSpanAttributes, type NormalizedSpan } from "@langwatch/trace-contract";

/**
 * Reads one span's attributes into the shape a trace summary uses; the rules
 * are the contract's `extractTraceSpanAttributes`.
 */
export class TraceAttributeExtractionService {
  private constructor() {}

  static create(): TraceAttributeExtractionService {
    return new TraceAttributeExtractionService();
  }

  extractAttributes(span: NormalizedSpan): Record<string, string> {
    return extractTraceSpanAttributes(span);
  }
}
