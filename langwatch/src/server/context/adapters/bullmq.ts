import type { Job } from "bullmq";
import {
  type RequestContext,
  type JobContextMetadata,
  getCurrentContext,
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
 * Trace/span IDs come from getCurrentContext() (OTel instrumentation).
 * Business context (org/project/user) comes from propagated metadata.
 */
export function createContextFromJobData(
  metadata?: JobContextMetadata,
): RequestContext {
  const currentContext = getCurrentContext();

  return {
    traceId: currentContext?.traceId,
    spanId: currentContext?.spanId,
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
 * Wraps a BullMQ job processor to automatically restore request context.
 *
 * Trace/span IDs come from OTel (BullMQ-otel instrumentation).
 * Business context (org/project/user) comes from propagated __context metadata.
 *
 * @example
 * ```typescript
 * const worker = new Worker<MyJob, void, string>(
 *   QUEUE_NAME,
 *   withJobContext(async (job) => {
 *     logger.info("Processing job"); // Will have traceId, projectId, etc.
 *   }),
 *   { connection, telemetry: new BullMQOtel(QUEUE_NAME) }
 * );
 * ```
 */
export function withJobContext<DataType, ResultType, NameType extends string>(
  processor: (job: Job<DataType, ResultType, NameType>) => Promise<ResultType>,
): (job: Job<DataType, ResultType, NameType>) => Promise<ResultType> {
  return async (job: Job<DataType, ResultType, NameType>) => {
    const jobData = job.data as JobDataWithContext<DataType>;
    const contextMetadata = jobData.__context;

    const requestContext = createContextFromJobData(contextMetadata);

    return await runWithContext(requestContext, async () => {
      return await processor(job);
    });
  };
}
