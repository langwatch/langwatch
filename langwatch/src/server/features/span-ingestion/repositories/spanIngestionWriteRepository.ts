import type { SpanIngestionWriteJob } from "../types/";

/**
 * Repository interface for span ingestion write operations
 */
export interface SpanIngestionWriteRepository {
  /**
   * Inserts span data into the persistent storage
   * @param jobData - The span ingestion write job data
   */
  insertSpan(jobData: SpanIngestionWriteJob): Promise<void>;
}
