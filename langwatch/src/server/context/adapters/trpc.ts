import { type RequestContext } from "../core";

/**
 * Creates a RequestContext from tRPC context and input.
 * Extracts business context (user from session, project/org from input).
 * Trace/span IDs come from OTel, not stored in RequestContext.
 */
export function createContextFromTRPC(
  ctx: {
    session?: { user?: { id?: string } } | null;
  },
  input?: { projectId?: string; organizationId?: string },
): RequestContext {
  return {
    organizationId: input?.organizationId,
    projectId: input?.projectId,
    userId: ctx.session?.user?.id,
  };
}
