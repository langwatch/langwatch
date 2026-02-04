import type { Context as HonoContext } from "hono";
import {
  type RequestContext,
  generateTraceId,
  generateSpanId,
  getOtelSpanContext,
} from "../core";

/**
 * Creates a RequestContext from a Hono context.
 * Extracts user, project, and organization from Hono's context store.
 */
export function createContextFromHono(c: HonoContext): RequestContext {
  const spanContext = getOtelSpanContext();

  return {
    traceId: c.get("traceId") ?? spanContext?.traceId ?? generateTraceId(),
    spanId: c.get("spanId") ?? spanContext?.spanId ?? generateSpanId(),
    organizationId: c.get("organization")?.id,
    projectId: c.get("project")?.id,
    userId: c.get("user")?.id,
  };
}
