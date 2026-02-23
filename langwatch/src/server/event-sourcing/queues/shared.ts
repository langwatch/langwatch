import type { Job, Queue } from "bullmq";
import { trace } from "@opentelemetry/api";
import type { SemConvAttributes } from "langwatch/observability";
import {
  type JobContextMetadata,
  createContextFromJobData,
  runWithContext,
} from "../../context/asyncContext";
import {
  type BullMQQueueState,
  recordJobWaitDuration,
  setBullMQJobCount,
} from "../../metrics";

/**
 * Shared retry/cleanup configuration for BullMQ queues.
 */
export const JOB_RETRY_CONFIG = {
  maxAttempts: 15,
  backoffDelayMs: 2000,
  removeOnCompleteAgeSec: 3600,
  removeOnCompleteCount: 100,
  removeOnFailAgeSec: 60 * 60 * 24 * 7, // 7 days
} as const;

/**
 * Legacy container type where payload was wrapped in __payload.
 * Only used for reading jobs that were enqueued before the format change.
 */
export type LegacyJobContainer<Payload> = {
  __payload: Payload;
  __context?: JobContextMetadata;
};

/**
 * Extracts payload and context from a BullMQ job, handling both
 * the legacy __payload wrapper and the new flat format.
 *
 * @param stripFields - Additional internal metadata fields to strip (e.g. __groupId, __stagedJobId)
 */
export function extractJobPayload<Payload>(
  job: Job<Payload>,
  stripFields?: string[],
): { payload: Payload; contextMetadata: JobContextMetadata | undefined } {
  const rawData = job.data as Record<string, unknown>;
  let payload: Payload;
  let contextMetadata: JobContextMetadata | undefined;

  if ("__payload" in rawData && rawData.__payload !== undefined) {
    const legacy = rawData as unknown as LegacyJobContainer<Payload>;
    payload = legacy.__payload;
    contextMetadata = legacy.__context;
  } else {
    const { __context, ...rest } = rawData;
    // Strip additional internal fields
    if (stripFields) {
      for (const field of stripFields) {
        delete rest[field];
      }
    }
    payload = rest as Payload;
    contextMetadata = __context as JobContextMetadata | undefined;
  }

  return { payload, contextMetadata };
}

/**
 * Runs a job handler with proper context propagation, span attributes, and metrics.
 */
export async function processJobWithContext<Payload>(params: {
  job: Job<Payload>;
  payload: Payload;
  contextMetadata: JobContextMetadata | undefined;
  queueName: string;
  spanAttributes?: (payload: Payload) => SemConvAttributes;
  handler: (payload: Payload) => Promise<void>;
}): Promise<void> {
  const { job, payload, contextMetadata, queueName, spanAttributes, handler } = params;

  const requestContext = createContextFromJobData(contextMetadata);
  recordJobWaitDuration(job, queueName);

  return runWithContext(requestContext, async () => {
    const customAttributes = spanAttributes ? spanAttributes(payload) : {};

    const span = trace.getActiveSpan();
    span?.setAttributes({
      ...customAttributes,
      ...(contextMetadata?.organizationId && {
        "organization.id": contextMetadata.organizationId,
      }),
      ...(contextMetadata?.projectId && {
        "tenant.id": contextMetadata.projectId,
      }),
      ...(contextMetadata?.userId && {
        "user.id": contextMetadata.userId,
      }),
    });

    if (contextMetadata?.traceId && contextMetadata?.parentSpanId) {
      span?.addLink({
        context: {
          traceId: contextMetadata.traceId,
          spanId: contextMetadata.parentSpanId,
          traceFlags: 1,
        },
      });
    }

    await handler(payload);
  });
}

/**
 * Collects BullMQ queue metrics (job counts by state).
 */
export async function collectBullMQMetrics(
  queue: Queue<any, unknown, string>,
  queueName: string,
): Promise<void> {
  const counts = await queue.getJobCounts();
  const states: Array<{ state: BullMQQueueState; count: number }> = [
    { state: "waiting", count: counts.waiting ?? 0 },
    { state: "active", count: counts.active ?? 0 },
    { state: "completed", count: counts.completed ?? 0 },
    { state: "failed", count: counts.failed ?? 0 },
    { state: "delayed", count: counts.delayed ?? 0 },
    { state: "paused", count: counts.paused ?? 0 },
    { state: "prioritized", count: counts.prioritized ?? 0 },
    { state: "waiting-children", count: counts["waiting-children"] ?? 0 },
  ];

  for (const { state, count } of states) {
    setBullMQJobCount(queueName, state, count);
  }
}
