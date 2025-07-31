import { type NextApiRequest, type NextApiResponse } from "next";
import { createLogger } from "../utils/logger";
import * as Sentry from "@sentry/nextjs";

const logger = createLogger("langwatch:pages-router:logger");

export function withPagesRouterLogger(
  handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>
) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const startTime = Date.now();
    
    // Extract basic request info
    const method = req.method ?? "UNKNOWN";
    const url = req.url ?? "";
    const userAgent = req.headers["user-agent"] ?? "unknown";
    
    // Extract additional context based on path
    const additionalContext = extractContextFromPath(req);

    let error: Error | null = null;

    try {
      // Execute the handler
      await handler(req, res);

    } catch (err) {
      error = err as Error;
      throw err;
    } finally {
      const duration = Date.now() - startTime;
      const status = res.statusCode ?? 500;
      
      const logData: Record<string, unknown> = {
        method,
        url,
        statusCode: status,
        duration,
        userAgent,
        ...additionalContext,
      };

      if (error) {
        logData.error = error instanceof Error ? error : JSON.stringify(error);
        logger.error(logData, "error handling request");
        
        // Capture in Sentry
        Sentry.captureException(error, {
          extra: {
            method,
            url,
            statusCode: status,
            duration,
            ...additionalContext,
          },
        });
      } else {
        logger.info(logData, "request handled");
      }
    }
  };
}

function extractContextFromPath(req: NextApiRequest): Record<string, unknown> {
  const url = req.url ?? "";
  const context: Record<string, unknown> = {};

  // Extract auth token for logging (without exposing the full token)
  const xAuthToken = req.headers["x-auth-token"];
  const authHeader = req.headers.authorization;
  const hasAuthToken = !!(
    xAuthToken ??
    (authHeader?.toLowerCase().startsWith("bearer ") ? authHeader.slice(7) : null)
  );

  // Note: In Next.js middleware, we don't have access to user/project/org context
  // like Hono does. These would need to be extracted in the actual route handlers.
  // For now, we'll include basic auth information.
  context.hasAuthToken = hasAuthToken;

  // Extract context based on path patterns
  if (url.startsWith("/api/collector")) {
    context.collectorType = "trace";
  }

  return context;
} 
