import type { NextRequest } from "next/server";
import type { NextApiRequest } from "next";
import { type RequestContext } from "../core";

/**
 * Creates a RequestContext from a Next.js App Router request.
 * Trace/span IDs come from OTel, not stored in RequestContext.
 * Business context needs to be populated by route handlers.
 */
export function createContextFromNextRequest(
  _req: NextRequest,
): RequestContext {
  // App Router middleware doesn't have access to session/user context
  // Those need to be populated by route handlers via updateCurrentContext
  return {};
}

/**
 * Creates a RequestContext from a Next.js Pages Router request.
 * Trace/span IDs come from OTel, not stored in RequestContext.
 * Business context needs to be populated by route handlers.
 */
export function createContextFromNextApiRequest(
  _req: NextApiRequest,
): RequestContext {
  // Pages Router middleware doesn't have access to session/user context
  // Those need to be populated by route handlers via updateCurrentContext
  return {};
}
