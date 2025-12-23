import type { SemConvAttributes } from "langwatch/observability";

export interface EventSourcedQueueProcessorOptions {
  concurrency?: number;
}

export interface EventSourcedQueueDefinition<Payload> {
  /**
   * Base name for the queue and job.
   * Queue name will be derived as `{name}` (with braces).
   * Job name will be `name` (without braces).
   */
  name: string;
  /**
   * Job ID factory.
   */
  makeJobId: (payload: Payload) => string;
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
   * Useful for batching/debouncing where later jobs can override earlier ones
   * (when combined with makeJobId). BullMQ will replace waiting jobs with the same jobId.
   */
  delay?: number;

  /**
   * Optional debounce time in milliseconds before processing the job.
   * Useful for batching/debouncing where later jobs can override earlier ones
   * (when combined with makeJobId). BullMQ will replace waiting jobs with the same jobId.
   */
  debounceMs?: number;

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
