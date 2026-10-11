import type {
  TraceFullReadInput,
  TraceFullRecord,
  TraceFullThreadReadInput,
} from "@langwatch/trace-contract";

import type { TraceIdIndexWindow } from "./trace-id-index-read.repository.ts";

/** Private persistence boundary for internal full Trace reads. */
export abstract class TraceFullRecordRepository {
  /** `window` is the id index's range for the trace; the summary is read inside it first. */
  abstract get(
    input: TraceFullReadInput,
    options?: { window?: TraceIdIndexWindow | undefined },
  ): Promise<TraceFullRecord>;

  abstract findThread(input: TraceFullThreadReadInput): Promise<TraceFullRecord[]>;
}
