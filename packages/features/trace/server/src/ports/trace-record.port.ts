import type { TraceByIdInput, TraceRecord } from "@langwatch/trace-contract";

export abstract class TraceRecordPort {
  abstract getById(input: TraceByIdInput): Promise<TraceRecord>;
}
