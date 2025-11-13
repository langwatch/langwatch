import type { SpanIngestionWriteJob } from "../types/spanIngestionWriteJob";

/**
 * Consumer interface for span ingestion write operations
 */
export interface SpanIngestionWriteConsumer {
  /**
   * Consumes a span ingestion write job and persists the data
   * @param jobData - The span ingestion write job data
   */
  consume(jobData: SpanIngestionWriteJob): Promise<void>;
}
