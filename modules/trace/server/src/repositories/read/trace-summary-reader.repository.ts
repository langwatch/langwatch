import type { TraceSummaryData } from "@langwatch/trace-contract";

/** Read boundary for the Trace-owned `trace_summaries` projection. */
export abstract class TraceSummaryReaderRepository {
  abstract findSummary(input: {
    tenantId: string;
    traceId: string;
  }): Promise<TraceSummaryData | null>;
}
