import {
  type RequestContext,
  type JobContextMetadata,
  getCurrentContext,
  generateTraceId,
  generateSpanId,
  getOtelSpanContext,
} from "../core";

/**
 * Creates a RequestContext from job metadata.
 * Used when processing background jobs to restore the context from the originating request.
 */
export function createContextFromJobData(
  metadata?: JobContextMetadata,
): RequestContext {
  const spanContext = getOtelSpanContext();

  return {
    // Use metadata trace/span if available, otherwise fall back to current span
    traceId: metadata?.traceId ?? spanContext?.traceId ?? generateTraceId(),
    spanId: spanContext?.spanId ?? generateSpanId(),
    organizationId: metadata?.organizationId,
    projectId: metadata?.projectId,
    userId: metadata?.userId,
  };
}

/**
 * Extracts job context metadata from the current context.
 * This should be attached to job payloads when sending to queues.
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
