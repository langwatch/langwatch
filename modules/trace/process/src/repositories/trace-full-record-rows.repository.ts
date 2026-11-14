import type { TraceFullReadInput, TraceFullThreadReadInput } from "@langwatch/trace-contract";

import type { StoredSpanRow } from "../rules/trace-full-record.rules.ts";

/** One trace_summaries row at its latest version, as a full record reads it. */
export type TraceFullSummaryRow = {
  TraceId: string;
  Attributes: Record<string, string>;
  ComputedInput: string | null;
  ComputedOutput: string | null;
  ContainsErrorStatus: boolean;
  ErrorMessage: string | null;
  TimeToFirstTokenMs: number | null;
  TotalDurationMs: number | null;
  TotalPromptTokenCount: number | null;
  TotalCompletionTokenCount: number | null;
  TotalCost: number | null;
  TokensEstimated: boolean;
  OccurredAtMs: number;
  CreatedAtMs: number;
  UpdatedAtMs: number;
};

/** One trace of a thread, dated by its summary. */
export type TraceFullThreadTraceRow = { TraceId: string; OccurredAtMs: number };

/** The rows a full trace record is assembled from, each read within one tenant. */
export abstract class TraceFullRecordRowsRepository {
  /** The trace's latest summary; throws TraceNotFoundError when the trace has none. */
  abstract getSummary(input: TraceFullReadInput): Promise<TraceFullSummaryRow>;

  /** The trace's latest stored spans, within two days of `occurredAtMs` when it is above zero. */
  abstract findSpans(input: {
    tenantId: string;
    traceId: string;
    occurredAtMs: number;
  }): Promise<StoredSpanRow[]>;

  /** At most 1000 of a thread's traces, oldest first. */
  abstract findThreadTraces(input: TraceFullThreadReadInput): Promise<TraceFullThreadTraceRow[]>;
}
