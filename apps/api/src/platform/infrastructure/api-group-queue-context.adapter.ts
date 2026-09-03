import {
  createContextFromJobData,
  getJobContextMetadata,
  runWithContext,
} from "@langwatch/observability/context";
import type { GroupQueueContextMetadata, GroupQueueContextPort } from "@langwatch/group-queue";

/**
 * Bridges the process request context into Group Queue. Queue-owned OTel spans
 * link to the captured producer span; this adapter restores only the business
 * fields required by the structured logger while a job handler runs.
 */
export class ApiGroupQueueContextAdapter implements GroupQueueContextPort {
  static create(): ApiGroupQueueContextAdapter {
    return new ApiGroupQueueContextAdapter();
  }

  private constructor() {}

  capture(): GroupQueueContextMetadata {
    const metadata = getJobContextMetadata();
    return {
      traceId: metadata.traceId,
      parentSpanId: metadata.parentSpanId,
      organizationId: metadata.organizationId,
      projectId: metadata.projectId,
      userId: metadata.userId,
    };
  }

  run<T>(metadata: GroupQueueContextMetadata | undefined, operation: () => Promise<T>): Promise<T> {
    return runWithContext(createContextFromJobData(metadata), operation);
  }
}
