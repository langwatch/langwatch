import type { TraceSummaryData } from "@langwatch/trace-contract";

export type TraceSummaryReadWindow = {
  fromMs: number;
  toMs: number;
};

export type TraceSummaryProjectionEntry = {
  data: TraceSummaryData;
  tenantId: string;
  retentionDays: number;
};

/** Private persistence capability for the trace_summaries projection. */
export abstract class TraceSummaryProjectionPort {
  abstract upsert(entry: TraceSummaryProjectionEntry): Promise<void>;

  async upsertBatch(_entries: TraceSummaryProjectionEntry[]): Promise<void> {
    throw new Error("Trace summary batch persistence is not implemented");
  }

  abstract tryFindByTraceId(input: {
    tenantId: string;
    traceId: string;
    window?: TraceSummaryReadWindow;
  }): Promise<TraceSummaryData | null>;
}
