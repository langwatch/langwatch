import type { SpanData } from "../schemas/commands";

/**
 * Data required to store a span.
 */
export interface StoreSpanData {
  tenantId: string;
  spanData: SpanData;
  collectedAtUnixMs: number;
}

/**
 * Repository interface for span storage operations.
 */
export interface SpanRepository {
  /**
   * Inserts span data into the persistent storage idempotently.
   * Uses the primary key (TenantId, TraceId, SpanId) for deduplication.
   *
   * @param data - The span data to store
   */
  insertSpan(data: StoreSpanData): Promise<void>;

  /**
   * Retrieves span data by trace ID and span ID.
   *
   * @param tenantId - The tenant ID
   * @param traceId - The trace ID
   * @param spanId - The span ID
   * @returns The span data if found, null otherwise
   */
  getSpanByTraceIdAndSpanId(
    tenantId: string,
    traceId: string,
    spanId: string,
  ): Promise<SpanData | null>;

  /**
   * Retrieves all spans for a given trace.
   *
   * @param tenantId - The tenant ID
   * @param traceId - The trace ID
   * @returns Array of all spans for the trace, empty array if none found
   */
  getSpansByTraceId(tenantId: string, traceId: string): Promise<SpanData[]>;
}
