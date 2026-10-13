import {
  hoistTraceOrigin,
  hoistTraceOriginSource,
  inferTraceOriginFromLegacyMarkers,
  type NormalizedSpan,
  stripLegacyTraceOriginMarkers,
} from "@langwatch/trace-contract";

/**
 * Resolves and hoists `langwatch.origin` and `langwatch.origin.source`
 * into trace-level attributes; the rules are the contract's pure functions.
 */
export class TraceOriginService {
  private constructor() {}

  static create(): TraceOriginService {
    return new TraceOriginService();
  }

  inferOriginFromLegacyMarkers(span: NormalizedSpan): string | undefined {
    return inferTraceOriginFromLegacyMarkers(span);
  }

  stripLegacyMarkers(mergedAttributes: Record<string, string>): void {
    stripLegacyTraceOriginMarkers(mergedAttributes);
  }

  hoistOrigin(input: Parameters<typeof hoistTraceOrigin>[0]): void {
    hoistTraceOrigin(input);
  }

  hoistSource(input: Parameters<typeof hoistTraceOriginSource>[0]): void {
    hoistTraceOriginSource(input);
  }
}
