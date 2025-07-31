import { type NextRequest, type NextResponse } from "next/server";
import { createLogger } from "../utils/logger";
import * as Sentry from "@sentry/nextjs";

const logger = createLogger("langwatch:app-router:logger");

export function withAppRouterLogger(
  handler: (req: NextRequest) => Promise<NextResponse>
) {
  return async (req: NextRequest) => {
    const startTime = Date.now();
    
    // Extract basic request info
    const method = req.method;
    const url = req.url;
    const userAgent = req.headers.get("user-agent") ?? "unknown";
    
    // Extract additional context based on path
    const additionalContext = extractContextFromPath(req);

    let error: Error | null = null;
    let response: NextResponse | null = null;

    try {
      // Execute the handler
      response = await handler(req);

    } catch (err) {
      error = err as Error;
      throw err;
    } finally {
      const duration = Date.now() - startTime;
      const status = response?.status ?? 500;
      
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

    return response;
  };
}

function extractContextFromPath(req: NextRequest): Record<string, unknown> {
  const path = req.nextUrl.pathname;
  const context: Record<string, unknown> = {};

  // Extract auth token for logging (without exposing the full token)
  const xAuthToken = req.headers.get("x-auth-token");
  const authHeader = req.headers.get("authorization");
  const hasAuthToken = !!(
    xAuthToken ??
    (authHeader?.toLowerCase().startsWith("bearer ") ? authHeader.slice(7) : null)
  );

  // Note: In Next.js middleware, we don't have access to user/project/org context
  // like Hono does. These would need to be extracted in the actual route handlers.
  // For now, we'll include basic auth information.
  context.hasAuthToken = hasAuthToken;

  // Extract context based on path patterns
  if (path.startsWith("/api/otel/v1/")) {
    context.otelVersion = "v1";
    context.otelType = path.split("/")[4]; // traces, logs, metrics
  }

  if (path.startsWith("/api/collector")) {
    context.collectorType = "trace";
  }

  return context;
} 
