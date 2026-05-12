import type { Context as HonoContext } from "hono";
import { type RequestContext } from "../core";

/**
 * Creates a RequestContext from a Hono context.
 * Extracts business context (user, project, organization) from Hono's context store.
 * Trace/span IDs come from OTel, not stored in RequestContext.
 */
export function createContextFromHono(c: HonoContext): RequestContext {
  return {
    organizationId: c.get("organization")?.id,
    projectId: c.get("project")?.id,
    userId: c.get("user")?.id,
  };
}
