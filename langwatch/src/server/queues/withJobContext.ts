import type { Job } from "bullmq";
import {
  createContextFromJobData,
  type JobContextMetadata,
  type JobDataWithContext,
  runWithContext,
} from "~/server/context/core";

/**
 * Legacy job data format where payload was wrapped in __payload.
 * Kept for migration of stuck jobs that pre-date the flattened shape.
 */
type LegacyJobData<T> = {
  __payload: T;
  __context?: JobContextMetadata;
};

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

/**
 * Wraps a BullMQ job processor to restore the propagated request context
 * (org/project/user) for the duration of `processor`. Trace/span IDs come
 * from BullMQ-otel; business context comes from the `__context` field on
 * the job payload (or the legacy `__payload`-wrapped shape).
 */
export function withJobContext<
  DataType extends Record<string, unknown>,
  ResultType,
  NameType extends string,
>(
  processor: (job: Job<DataType, ResultType, NameType>) => Promise<ResultType>,
): (job: Job<DataType, ResultType, NameType>) => Promise<ResultType> {
  return async (job: Job<DataType, ResultType, NameType>) => {
    const normalizedData = normalizeJobData(job.data);
    const contextMetadata = normalizedData.__context;

    if ("__payload" in job.data) {
      (job as any).data = normalizedData;
    }

    const requestContext = createContextFromJobData(contextMetadata);
    return await runWithContext(requestContext, async () => {
      return await processor(job);
    });
  };
}
