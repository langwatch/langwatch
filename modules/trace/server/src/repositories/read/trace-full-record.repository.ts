import type {
  TraceFullReadInput,
  TraceFullRecord,
  TraceFullThreadReadInput,
} from "@langwatch/trace-contract";

/** Private persistence boundary for internal full Trace reads. */
export abstract class TraceFullRecordRepository {
  abstract get(input: TraceFullReadInput): Promise<TraceFullRecord>;

  abstract getThread(input: TraceFullThreadReadInput): Promise<TraceFullRecord[]>;
}
