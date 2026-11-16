import type { TraceAttributeMatch } from "@langwatch/trace-contract";

/** Per-project trace counts from the trace_summaries projection, and the project's stored bytes. */
export abstract class TraceUsageCountRepository {
  /**
   * One page of the trace ids whose summary was first written in `[fromMs, toMs)`, in id order
   * after `afterTraceId`; a trace first seen before `fromMs` is not listed.
   */
  abstract findTraceIdsFirstSeen(input: {
    tenantId: string;
    fromMs: number;
    toMs: number;
    afterTraceId: string;
    limit: number;
  }): Promise<string[]>;
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
  /** The sum of `_size_bytes` over the tenant's spans and trace summaries (ADR-202 Decided 20). */
  abstract getStoredBytes(input: { tenantId: string }): Promise<number>;
}
