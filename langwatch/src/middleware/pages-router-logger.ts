import type { NextApiRequest, NextApiResponse } from "next";
import { createLogger } from "../utils/logger/server";
import {
  createContextFromNextApiRequest,
  runWithContext,
} from "../server/context/asyncContext";
import {
  hasAuthorizationToken,
  logHttpRequest,
} from "../server/middleware/requestLogging";

const logger = createLogger("langwatch:pages-router:logger");

export function withPagesRouterLogger(
  handler: (
    req: NextApiRequest,
    res: NextApiResponse,
  ) => Promise<void | NextApiResponse>,
) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    // Create context from Next.js API request and run within it
    const ctx = createContextFromNextApiRequest(req);

    return runWithContext(ctx, async () => {
      const startTime = Date.now();

      // Extract basic request info
      const method = req.method ?? "UNKNOWN";
      const url = req.url ?? "";
      const userAgent = req.headers["user-agent"] ?? null;

      // Extract additional context based on request
      const extra = extractContextFromRequest(req);

      let error: Error | null = null;

      try {
        // Execute the handler
        await handler(req, res);
      } catch (err) {
        error = err as Error;
        throw err;
      } finally {
        const duration = Date.now() - startTime;
        const statusCode = res.statusCode ?? 500;

        // Log the request
        logHttpRequest(logger, {
          method,
          url,
          statusCode,
          duration,
          userAgent,
          error: error ?? undefined,
          extra,
        });
      }
    });
  };
}

function extractContextFromRequest(
  req: NextApiRequest,
): Record<string, unknown> {
  const url = req.url ?? "";
  const context: Record<string, unknown> = {};

  // Check for auth token presence (without exposing the token value)
  context.hasAuthToken = hasAuthorizationToken({
    "x-auth-token": req.headers["x-auth-token"] as string | undefined,
    authorization: req.headers.authorization,
  });

  // Extract context based on path patterns
  if (url.startsWith("/api/collector")) {
    context.collectorType = "trace";
  }

  return context;
}
