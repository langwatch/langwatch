import type { Job } from "bullmq";
import {
  type RequestContext,
  type JobContextMetadata,
  getCurrentContext,
  getOtelSpanContext,
  runWithContext,
} from "../core";

// Note: getCurrentContext is used by getJobContextMetadata for business context

/**
 * Type for job data that includes the optional __context field.
 * Used by QueueWithFallback to propagate context through queues.
 * T must be an object type to allow spreading with __context.
 */
export type JobDataWithContext<T extends Record<string, unknown>> = T & {
  __context?: JobContextMetadata;
};

/**
 * Creates a RequestContext for job processing.
 *
 * Trace/span IDs come from OTel (via BullMQ-otel instrumentation).
 * Business context (org/project/user) comes from propagated metadata.
 */
export function createContextFromJobData(
  metadata?: JobContextMetadata,
): RequestContext {
  return {
    organizationId: metadata?.organizationId,
    projectId: metadata?.projectId,
    userId: metadata?.userId,
  };
}

/**
 * Extracts context metadata for job propagation.
 * - Trace/span from OTel for span linking (event-sourcing)
 * - Business context from ALS for logging
 */
export function getJobContextMetadata(): JobContextMetadata {
  const spanContext = getOtelSpanContext();
  const ctx = getCurrentContext();

  return {
    traceId: spanContext?.traceId,
    parentSpanId: spanContext?.spanId,
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
 *   { connection, telemetry: createWorkerTelemetry(QUEUE_NAME) }
 * );
 * ```
 */
/**
 * Legacy job data format where payload was wrapped in __payload.
 * Used for migration of stuck jobs from old format.
 */
type LegacyJobData<T> = {
  __payload: T;
  __context?: JobContextMetadata;
};

/**
 * Normalizes job data by unwrapping legacy __payload format if present.
 * Old jobs have: { __payload: { traceId, spans, ... }, __context?: {...} }
 * New jobs have: { traceId, spans, ..., __context?: {...} }
 */
function normalizeJobData<DataType extends Record<string, unknown>>(
  data: DataType | LegacyJobData<DataType>,
): JobDataWithContext<DataType> {
  if ("__payload" in data && data.__payload !== undefined) {
    const legacyData = data as LegacyJobData<DataType>;
    return {
      ...legacyData.__payload,
      __context: legacyData.__context,
    } as JobDataWithContext<DataType>;
  }
  return data as JobDataWithContext<DataType>;
}

export function withJobContext<
  DataType extends Record<string, unknown>,
  ResultType,
  NameType extends string,
>(
  processor: (job: Job<DataType, ResultType, NameType>) => Promise<ResultType>,
): (job: Job<DataType, ResultType, NameType>) => Promise<ResultType> {
  return async (job: Job<DataType, ResultType, NameType>) => {
    // Normalize legacy job data format (unwrap __payload if present)
    const normalizedData = normalizeJobData(job.data);
    const contextMetadata = normalizedData.__context;

    // Update job.data in place so processor sees the normalized data
    if ("__payload" in job.data) {
      (job as any).data = normalizedData;
    }

    const requestContext = createContextFromJobData(contextMetadata);

    return await runWithContext(requestContext, async () => {
      return await processor(job);
    });
  };
}
