import type { DerivedTraceEvent, TraceDerivedEventsInput } from "@langwatch/trace-contract";

export abstract class TraceEventDerivationPort {
  abstract derive(input: TraceDerivedEventsInput): Promise<DerivedTraceEvent[]>;
}
