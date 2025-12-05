import type {
  StoreSpanIngestionCommandData,
  SpanData,
} from "../schemas/commands";

/**
 * Repository interface for span storage operations
 */
export interface SpanRepository {
  /**
   * Inserts span data into the persistent storage
   * @param command - The span ingestion command data with tenantId, spanData, and collectedAtUnixMs
   */
  insertSpan(command: StoreSpanIngestionCommandData): Promise<void>;

  /**
   * Retrieves span data by trace ID and span ID.
   * Used by event handlers that need to access full span data.
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
   * Used by trace aggregation to collect all spans for a trace.
   * @param tenantId - The tenant ID
   * @param traceId - The trace ID
   * @returns Array of all spans for the trace, empty array if none found
   */
  getSpansByTraceId(tenantId: string, traceId: string): Promise<SpanData[]>;
}
