import type { TraceAttributeMatch } from "@langwatch/trace-contract";

/** Per-project trace counts read from the trace_summaries projection. */
export abstract class TraceUsageCountRepository {
  /**
   * Distinct traces whose summary was first written in `[fromMs, toMs)`: a trace first seen
   * before `fromMs` is not counted again. Exact, for entitlement's seeded trace count.
   */
  abstract countTracesFirstSeen(input: {
    tenantId: string;
    fromMs: number;
    toMs: number;
  }): Promise<number>;
  abstract countTracesInLastDay(input: { tenantId: string }): Promise<number>;
  abstract hasTraceWithAttribute(input: {
    tenantId: string;
    sinceMs: number;
    attribute: TraceAttributeMatch;
  }): Promise<boolean>;
  abstract findTraceCountsByAttribute(input: {
    tenantId: string;
    sinceMs: number;
    attribute: TraceAttributeMatch;
    groupByKey: string;
  }): Promise<{ value: string; count: number }[]>;
}
