import { INVALID_TRACE_ID } from "@langwatch/observability/constants";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { HandledError } from "~/server/app-layer/handled-error";
import { NotFoundError as PromptNotFoundError } from "~/server/prompt-config/errors";
import {
  grafanaConfigFromEnv,
  grafanaLinksForTrace,
} from "~/utils/grafanaLinks";

import { HttpError, NotFoundError } from "../shared/errors";
import { errorSchema } from "../shared/schemas";

const INVALID_SPAN_ID = "0".repeat(16);

/**
 * Error handling middleware that catches errors and formats responses.
 * Should be used with the `onError` callback of the Hono app.
 * @see https://hono.dev/docs/api/hono#error-handling
 *
 * @example
 * ```ts
 * app.onError(handleError);
 * ```
 */
export const handleError = async (
  error: Error & {
    status?: ContentfulStatusCode;
    code?: string;
    name?: string;
  },
  c: Context,
) => {
  // Determine status code and response
  // Note: Logging is handled by the logger middleware, not here, to avoid double logging
  const { statusCode, response } = determineErrorResponse(error);

  return c.json(withTraceInfo(response, c), statusCode);
};

/**
 * Attach the request's trace/span ids and — when a Grafana is configured —
 * clickable Grafana links to the error body, so anyone can jump from the network
 * inspector straight to the failing trace/logs. The ids come from the tracer
 * middleware (c.get("traceId"/"spanId")).
 *
 * Included in production too: Grafana is access-controlled (behind AWS auth, not
 * public), so the URL leaks nothing to a caller who can't reach it, and the
 * trace/span ids are opaque correlation handles.
 */
function withTraceInfo(response: object, c: Context): object {
  const traceId = liveId(
    c.get("traceId") as string | undefined,
    INVALID_TRACE_ID,
  );
  const spanId = liveId(c.get("spanId") as string | undefined, INVALID_SPAN_ID);
  if (!traceId && !spanId) return response;

  const links = grafanaLinksForTrace(traceId, grafanaConfigFromEnv());
  return { ...response, trace: { traceId, spanId, ...(links ?? {}) } };
}

// An all-zero id is OpenTelemetry's "no valid span" sentinel — treat it as absent.
function liveId(id: string | undefined, zero: string): string | undefined {
  return id && id !== zero ? id : undefined;
}

function determineErrorResponse(
  error: Error & {
    status?: ContentfulStatusCode;
    code?: string;
    name?: string;
  },
): { statusCode: ContentfulStatusCode; response: object } {
  // HandledErrors are handled first — normalize to client-safe shape.
  // Use code + httpStatus check instead of instanceof to handle
  // module-boundary class identity mismatches in Next.js/turbopack.
  // See handled-error.ts: "use code instead of instanceof in cross-process cases"
  if (HandledError.is(error) || ("code" in error && "httpStatus" in error)) {
    const { code, message, httpStatus, meta } = error as HandledError;
    return {
      statusCode: (httpStatus ?? 500) as ContentfulStatusCode,
      response: {
        ...errorSchema.parse({ error: code, message }),
        ...(meta ?? {}),
      },
    };
  }

  // Check if it's a "not found" error
  const isNotFoundError =
    // Prisma error code for "not found"
    error.code === "P2025" ||
    error instanceof NotFoundError ||
    error.name === "NotFoundError";

  if (isNotFoundError) {
    const notFoundError = new NotFoundError(error.message);
    return {
      statusCode: notFoundError.status,
      response: errorSchema.parse(notFoundError),
    };
  }

  // Prisma unique-constraint violation → 409 with a descriptive message.
  // Only P2002 should land here: other `PrismaClientKnownRequestError`
  // codes (P2003 foreign-key, P2021 missing table, etc.) are real backend
  // failures and must not be mislabeled as conflicts.
  if (error.code === "P2002") {
    const target = (error as { meta?: { target?: unknown } }).meta?.target;
    const targetStr = Array.isArray(target)
      ? target.join(", ")
      : typeof target === "string"
        ? target
        : undefined;
    return {
      statusCode: 409,
      response: errorSchema.parse({
        error: "Conflict",
        message: targetStr
          ? `Unique constraint violated on ${targetStr}`
          : error.message || "Unique constraint violated",
      }),
    };
  }

  // Handle HttpError instances (can be parsed directly)
  if (error instanceof HttpError) {
    if (error.status >= 500) {
      return {
        statusCode: error.status,
        response: errorSchema.parse({
          error: "Internal server error",
          message: "An unknown error occurred",
        }),
      };
    }
    return {
      statusCode: error.status,
      response: errorSchema.parse(error),
    };
  }

  if (error.status) {
    const isServerError = error.status >= 500;
    return {
      statusCode: error.status,
      response: errorSchema.parse({
        error: isServerError
          ? "Internal server error"
          : error.message || "An error occurred",
        message: isServerError ? "An unknown error occurred" : error.message,
      }),
    };
  }

  // Unexpected failures are logged and traced by the request middleware. The
  // HTTP boundary must not turn their implementation detail (Prisma models,
  // SQL, hosts, stack fragments) into public API copy. The structured trace
  // block added by withTraceInfo remains the safe correlation channel.
  return {
    statusCode: 500,
    response: errorSchema.parse({
      error: "Internal server error",
      message: "An unknown error occurred",
    }),
  };
}
