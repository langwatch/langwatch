import { ATTR_KEYS } from "@langwatch/span-normalisation";
import { accumulateTraceAttributes, stampTraceModelMetadata } from "@langwatch/trace-contract";

import type { TraceOriginService } from "../../../services/trace-origin.service.ts";

/**
 * The keys a log's lifted attributes only fill when the trace has none: a span or the origin
 * resolution names a trace's service and origin first, and a log never replaces them.
 */
export const LOG_FILL_ONLY_KEYS: ReadonlySet<string> = new Set([
  ATTR_KEYS.SERVICE_NAME,
  "langwatch.origin",
]);

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
