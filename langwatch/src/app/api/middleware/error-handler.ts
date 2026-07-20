import { INVALID_TRACE_ID } from "@langwatch/observability/constants";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { HandledError } from "@langwatch/handled-error";
import { NotFoundError as PromptNotFoundError } from "~/server/prompt-config/errors";
import { ModelNotConfiguredError } from "~/server/modelProviders/modelNotConfiguredError";
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
  // isHandled covers real instances plus ones from a second copy of the
  // module, which bare `instanceof` misses. The code + httpStatus tail
  // additionally accepts an already-serialised payload reaching this handler;
  // we only read fields off it below, never call its methods.
  if (
    HandledError.isHandled(error) ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      "httpStatus" in error)
  ) {
    const { code, message, httpStatus, meta } = error as HandledError;
    const { tips, docsUrl, fault } = error as HandledError;
    return {
      statusCode: (httpStatus ?? 500) as ContentfulStatusCode,
      response: {
        ...errorSchema.parse({ error: code, message }),
        ...(meta ?? {}),
        // Additive remediation channel (agents read these; older clients
        // and the Python SDK ignore unknown keys).
        ...(tips?.length ? { tips } : {}),
        ...(docsUrl ? { docsUrl } : {}),
        ...(fault ? { fault } : {}),
      },
    };
  }

  // ModelNotConfiguredError: a project tried an action that needs a resolved
  // model (e.g. creating an evaluator) with no provider configured at any
  // scope. This is a real, common first-touch case for a fresh project, not
  // a server fault — give the caller (UI or an API/MCP client) the same
  // structured cause the tRPC interceptor already surfaces on the wire
  // (`utils/trpcError.ts::extractMissingModelInfo`), instead of falling
  // through to the generic 500 below.
  if (error instanceof ModelNotConfiguredError) {
    return {
      statusCode: 400,
      response: {
        ...errorSchema.parse({
          error: "model_not_configured",
          message: error.message,
        }),
        ...error.toResponseBody(),
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
