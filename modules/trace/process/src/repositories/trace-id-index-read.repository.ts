import type { IdIndexFlags } from "@langwatch/clickhouse-client";

/** A time range an id index names, already widened, in epoch ms. */
export type TraceIdIndexWindow = Readonly<{ fromMs: number; toMs: number }>;

/** The trace tables with an id index (goose 00110). */
export type TraceIdIndexSource = "trace_summaries" | "stored_spans" | "trace_analytics";

/**
 * The time range trace's id indexes name for some traces, for a read whose client cannot ask the
 * index itself. Empty when the index is not ready on the tenant's target or the index has no row.
 */
export abstract class TraceIdIndexReadRepository {
  abstract findWindows(input: {
    tenantId: string;
    traceIds: readonly string[];
    source: TraceIdIndexSource;
    idIndex: IdIndexFlags | undefined;
  }): Promise<TraceIdIndexWindow[]>;
}
