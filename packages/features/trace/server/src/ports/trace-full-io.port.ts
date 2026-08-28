import type { NormalizedSpan, TraceRecordValue } from "@langwatch/trace-contract";

export abstract class TraceFullIoPort {
  abstract recompute(spans: NormalizedSpan[]): {
    input: { type: string; value: TraceRecordValue } | null;
    output: { type: string; value: TraceRecordValue } | null;
  };
}
