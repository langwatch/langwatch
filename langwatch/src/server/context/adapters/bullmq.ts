import type { Job } from "bullmq";
import {
  type RequestContext,
  type JobContextMetadata,
  getCurrentContext,
  generateTraceId,
  generateSpanId,
  runWithContext,
} from "../core";

/**
 * Type for job data that includes the optional __context field.
 * Used by QueueWithFallback to propagate context through queues.
 */
export type JobDataWithContext<T> = T & {
  __context?: JobContextMetadata;
};

/**
 * Creates a RequestContext for job processing.
 *
 * Trace/span IDs come from getCurrentContext() (which checks OTel).
 * Business context (org/project/user) comes from propagated metadata.
 */
export function createContextFromJobData(
  metadata?: JobContextMetadata,
): RequestContext {
  // Get current context - trace/span come from OTel, business context from metadata
  const currentContext = getCurrentContext();

  return {
    traceId: currentContext?.traceId ?? generateTraceId(),
    spanId: currentContext?.spanId ?? generateSpanId(),
    organizationId: metadata?.organizationId,
    projectId: metadata?.projectId,
    userId: metadata?.userId,
  };
}

/**
 * Extracts context metadata for job propagation.
 * Includes trace/span IDs for OTel span linking (used by event-sourcing).
 */
export function getJobContextMetadata(): JobContextMetadata {
  const ctx = getCurrentContext();

  return {
    traceId: ctx?.traceId,
    parentSpanId: ctx?.spanId,
    organizationId: ctx?.organizationId,
    projectId: ctx?.projectId,
    userId: ctx?.userId,
  };
}

/**
 * Options for the withJobContext wrapper.
 */
export type WithJobContextOptions<DataType> = {
  /**
   * Extract additional context fields from job data.
   * Use when job data contains context (like projectId) not in the original request.
   */
  getContextFromData?: (data: DataType) => Partial<JobContextMetadata>;
};

/**
 * Wraps a BullMQ job processor to automatically restore request context.
 *
 * @example
 * ```typescript
 * const worker = new Worker<MyJob, void, string>(
 *   QUEUE_NAME,
 *   withJobContext(async (job) => {
 *     logger.info("Processing job"); // Will have traceId, projectId, etc.
 *   }),
 *   { connection }
 * );
 * ```
 */
export function withJobContext<DataType, ResultType, NameType extends string>(
  processor: (job: Job<DataType, ResultType, NameType>) => Promise<ResultType>,
  options?: WithJobContextOptions<DataType>,
): (job: Job<DataType, ResultType, NameType>) => Promise<ResultType> {
  return async (job: Job<DataType, ResultType, NameType>) => {
    const jobData = job.data as JobDataWithContext<DataType>;
    const contextMetadata = jobData.__context;

    // Merge propagated context with additional context from job data
    const additionalContext = options?.getContextFromData?.(job.data);

    const requestContext = createContextFromJobData({
      ...contextMetadata,
      ...additionalContext,
    });

    return await runWithContext(requestContext, async () => {
      return await processor(job);
    });
  };
}
