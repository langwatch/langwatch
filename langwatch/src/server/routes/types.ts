/**
 * Minimal type shims replacing Next.js types (NextApiRequest, NextRequest).
 * Used by Hono route handlers that build request shims for tRPC context.
 */
import type { IncomingHttpHeaders } from "http";

/**
 * Minimal NextApiRequest shim — only the fields our tRPC context factory uses.
 */
export interface NextApiRequestShim {
  headers: Record<string, string | string[] | undefined> | IncomingHttpHeaders;
  method?: string;
  url?: string;
  query?: Record<string, string | string[]>;
  socket?: { remoteAddress?: string };
  cookies?: Record<string, string>;
}

/**
 * Minimal NextRequest shim — extends Request with the same interface
 * that getServerAuthSession expects.
 */
export type NextRequestShim = Request;
