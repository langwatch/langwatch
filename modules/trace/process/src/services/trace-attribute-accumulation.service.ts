import { accumulateTraceAttributes, stampTraceModelMetadata } from "@langwatch/trace-contract";

import type { TraceOriginService } from "./trace-origin.service.ts";

/**
 * Merges per-span attributes into trace-level attributes; the rules, origin
 * hoisting included, are the contract's `accumulateTraceAttributes`.
 */
export class TraceAttributeAccumulationService {
  private constructor() {}

  // The origin service stays a parameter so existing wiring is unchanged.
  static create(_traceOriginService: TraceOriginService): TraceAttributeAccumulationService {
    return new TraceAttributeAccumulationService();
  }

  accumulateAttributes(
    input: Parameters<typeof accumulateTraceAttributes>[0],
  ): Record<string, string> {
    return accumulateTraceAttributes(input);
  }

  stampModelMetadata(input: Parameters<typeof stampTraceModelMetadata>[0]): void {
    stampTraceModelMetadata(input);
  }
}
