import type { StoreSpanIngestionCommandData } from "../types/storeSpanIngestionCommand";

/**
 * Repository interface for span storage operations
 */
export interface SpanRepository {
  /**
   * Inserts span data into the persistent storage
   * @param command - The span ingestion command data with tenantId, spanData, and collectedAtUnixMs
   */
  insertSpan(command: StoreSpanIngestionCommandData): Promise<void>;
}

