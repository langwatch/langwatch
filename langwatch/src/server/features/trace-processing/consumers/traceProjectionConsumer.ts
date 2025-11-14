import type { TraceProjectionJob } from "../types";

/**
 * Consumer interface for processing trace projection computation jobs.
 */
export interface TraceProjectionConsumer {
  /**
   * Processes a trace projection job to rebuild trace projections.
   */
  consume(job: TraceProjectionJob): Promise<void>;
}

