import type { TraceByIdInput, TraceRecord } from "@langwatch/trace-contract";

export abstract class TraceRecordRepository {
  abstract getById(input: TraceByIdInput): Promise<TraceRecord>;
}
