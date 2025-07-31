import { type NextRequest, NextResponse } from "next/server";
import { createLogger } from "./src/utils/logger";
import * as Sentry from "@sentry/nextjs";

const logger = createLogger("langwatch:middleware");

// Define which paths should be logged
const LOGGED_PATHS = [
  "/api/otel/v1/traces",
  "/api/otel/v1/logs",
  "/api/otel/v1/metrics",
  "/api/collector",
];

// Define paths that should be excluded from logging (e.g., health checks)
const EXCLUDED_PATHS = ["/api/health", "/api/healthz", "/api/ready"];


export function middleware(request: NextRequest) {
  const url = new URL(request.url);
  const path = url.pathname;

  // Check if this path should be logged
  const shouldLog = LOGGED_PATHS.some((loggedPath) =>
    path.startsWith(loggedPath)
  );
  const isExcluded = EXCLUDED_PATHS.some((excludedPath) =>
    path.startsWith(excludedPath)
  );

  if (!shouldLog || isExcluded) {
    return NextResponse.next();
  }

  return logRequest(request);
}

async function logRequest(request: NextRequest) {
  const startTime = Date.now();

  // Extract basic request info
  const url = new URL(request.url);
  const method = request.method;
  const userAgent = request.headers.get("user-agent") ?? "unknown";

  // Extract additional context based on path
  const additionalContext = extractContextFromPath(request);

  // Log request start
  logger.info(
    {
      method,
      url: request.url,
      userAgent,
      ...additionalContext,
    },
    `[${method}] ${url.pathname} - Request started`
  );

  let error: Error | null = null;
  let response: NextResponse | null = null;

  try {
    response = NextResponse.next();
  } catch (err) {
    error = err as Error;
    throw err;
  } finally {
    const duration = Date.now() - startTime;
    const status = response?.status ?? 500;

    const logData: Record<string, unknown> = {
      method,
      url: request.url,
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
          url: request.url,
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
}

function extractContextFromPath(request: NextRequest): Record<string, unknown> {
  const path = request.nextUrl.pathname;
  const context: Record<string, unknown> = {};

  // Extract auth token for logging (without exposing the full token)
  const xAuthToken = request.headers.get("x-auth-token");
  const authHeader = request.headers.get("authorization");
  const hasAuthToken = !!(
    xAuthToken ??
    (authHeader?.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7)
      : null)
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

// Configure which paths this middleware should run on
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    "/((?!_next/static|_next/image|favicon.ico|public/).*)",
  ],
};
