import type { NextRequest } from "next/server";
import type { NextApiRequest } from "next";
import {
  type RequestContext,
  generateTraceId,
  generateSpanId,
  getOtelSpanContext,
} from "../core";

/**
 * Creates a RequestContext from a Next.js App Router request.
 */
export function createContextFromNextRequest(
  _req: NextRequest,
): RequestContext {
  const spanContext = getOtelSpanContext();

  return {
    traceId: spanContext?.traceId ?? generateTraceId(),
    spanId: spanContext?.spanId ?? generateSpanId(),
    // App Router middleware doesn't have access to session/user context
    // Those need to be populated by route handlers
  };
}

/**
 * Creates a RequestContext from a Next.js Pages Router request.
 */
export function createContextFromNextApiRequest(
  _req: NextApiRequest,
): RequestContext {
  const spanContext = getOtelSpanContext();

  return {
    traceId: spanContext?.traceId ?? generateTraceId(),
    spanId: spanContext?.spanId ?? generateSpanId(),
    // Pages Router middleware doesn't have access to session/user context
    // Those need to be populated by route handlers
  };
}
