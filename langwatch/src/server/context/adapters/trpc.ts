import {
  type RequestContext,
  generateTraceId,
  generateSpanId,
  getOtelSpanContext,
} from "../core";

/**
 * Creates a RequestContext from tRPC context and input.
 * Extracts user from session, project/org from input.
 */
export function createContextFromTRPC(
  ctx: {
    session?: { user?: { id?: string } } | null;
  },
  input?: { projectId?: string; organizationId?: string },
): RequestContext {
  const spanContext = getOtelSpanContext();

  return {
    traceId: spanContext?.traceId ?? generateTraceId(),
    spanId: spanContext?.spanId ?? generateSpanId(),
    organizationId: input?.organizationId,
    projectId: input?.projectId,
    userId: ctx.session?.user?.id,
  };
}
