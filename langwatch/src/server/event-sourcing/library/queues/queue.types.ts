import type { SemConvAttributes } from "langwatch/observability";

export interface EventSourcedQueueProcessorOptions {
  concurrency?: number;
}

/**
 * Configuration for job deduplication.
 * When enabled, jobs with the same deduplication ID will be deduplicated within the TTL window.
 */
export interface DeduplicationConfig<Payload> {
  /**
   * Function to generate deduplication ID from payload.
   * Jobs with the same deduplication ID will be deduplicated within the TTL window.
   */
  makeId: (payload: Payload) => string;
  /**
   * TTL for deduplication in milliseconds.
   * @default 200
   */
  ttlMs?: number;
  /**
   * Whether to extend the TTL when a new job with the same deduplication ID is added.
   * When true, enables Debounce Mode where new jobs replace existing ones and reset the TTL.
   * @default true
   */
  extend?: boolean;
  /**
   * Whether to replace the job data when a new job with the same deduplication ID is added.
   * When true, enables Debounce Mode where the latest job data is used.
   * @default true
   */
  replace?: boolean;
}

export interface EventSourcedQueueDefinition<Payload> {
  /**
   * Base name for the queue and job.
   * Queue name will be derived as `{name}` (with braces).
   * Job name will be `name` (without braces).
   */
  name: string;
  /**
   * Domain-specific processor that runs inside the worker.
   */
  process: (payload: Payload) => Promise<void>;

  /**
   * Optional options for the queue processor.
   */
  options?: EventSourcedQueueProcessorOptions;

  /**
   * Optional delay in milliseconds before processing the job.
   */
  delay?: number;

  /**
   * Optional deduplication configuration.
   * When set, jobs with the same deduplication ID will be deduplicated within the TTL window.
   */
  deduplication?: DeduplicationConfig<Payload>;

  /**
   * Optional function to extract span attributes from the payload.
   * These attributes will be merged with common attributes like queue.name, queue.job_name, etc.
   */
  spanAttributes?: (payload: Payload) => SemConvAttributes;
}

export interface EventSourcedQueueProcessor<Payload> {
  send(payload: Payload): Promise<void>;
  /**
   * Gracefully closes the queue processor, waiting for in-flight jobs to complete.
   * Should be called during application shutdown.
   */
  close(): Promise<void>;
}
