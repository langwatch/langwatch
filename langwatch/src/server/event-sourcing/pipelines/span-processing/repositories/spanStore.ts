import type { RecordSpanProcessingCommandData } from "../types/";

/**
 * Command data with tenantId for span storage operations
 */
export interface SpanStoreCommand extends RecordSpanProcessingCommandData {
  tenantId: string;
}

/**
 * Repository interface for span storage operations
 */
export interface SpanStore {
  /**
   * Inserts span data into the persistent storage
   * @param command - The span processing command data with tenantId
   */
  insertSpan(command: SpanStoreCommand): Promise<void>;
}
