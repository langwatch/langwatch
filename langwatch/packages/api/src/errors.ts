import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";

import { httpStatusText } from "./types.js";

// ---------------------------------------------------------------------------
// Duck-typed interfaces for HandledError (no imports from langwatch app)
// ---------------------------------------------------------------------------

/**
 * Shape that a HandledError-like object must satisfy for the framework error
 * handler to use its `serialize()` output.
 *
 * We duck-type rather than import so this package stays standalone.
 */
interface HandledErrorLike {
  code: string;
  message: string;
  httpStatus: number;
  meta: Record<string, unknown>;
  serialize(): {
    code: string;
    meta: Record<string, unknown>;
    traceId?: string;
    spanId?: string;
    traceUrl?: string;
    httpStatus: number;
    reasons: Array<{
      code: string;
      meta?: Record<string, unknown>;
      reasons?: unknown[];
    }>;
  };
}

function isHandledErrorLike(err: unknown): err is HandledErrorLike {
  if (typeof err !== "object" || err === null) return false;
  const obj = err as Record<string, unknown>;
  return (
    typeof obj["code"] === "string" &&
    typeof obj["httpStatus"] === "number" &&
    typeof obj["serialize"] === "function"
  );
}

// ---------------------------------------------------------------------------
// Zod error mapping
// ---------------------------------------------------------------------------

interface ValidationReason {
  code: "schema_failure";
  meta: {
    field: string;
    type: string;
    message: string;
  };
}

interface ValidationErrorPayload {
  code: "validation_error";
  message: string;
  reasons: ValidationReason[];
  httpStatus: 422;
}

function zodErrorToPayload(err: ZodError): ValidationErrorPayload {
  return {
    code: "validation_error",
    message: "Validation error",
    reasons: err.issues.map((issue) => ({
      code: "schema_failure" as const,
      meta: {
        field: issue.path.join(".") || "(root)",
        type: issue.code,
        message: issue.message,
      },
    })),
    httpStatus: 422,
  };
}

// ---------------------------------------------------------------------------
// Error response formatting
// ---------------------------------------------------------------------------

interface ErrorResponseBody {
  /** Present only for unversioned (backwards-compat) responses. */
  error?: string;
  code: string;
  message: string;
  meta?: Record<string, unknown>;
  reasons?: unknown[];
  traceId?: string;
  spanId?: string;
  traceUrl?: string;
}

function finalizeErrorResponse({
  status,
  body,
  isVersioned,
}: {
  status: ContentfulStatusCode;
  body: ErrorResponseBody;
  isVersioned: boolean;
}): { status: ContentfulStatusCode; body: ErrorResponseBody } {
  if (!isVersioned) body.error = httpStatusText(status);
  return { status, body };
}

/**
 * Formats an error into a JSON response body + status code.
 *
 * @param isVersioned - Whether the request was made through a versioned path.
 *   Versioned requests get the new format only; unversioned get a union
 *   format that includes the legacy `error` field.
 */
function formatError({
  err,
  isVersioned,
}: {
  err: unknown;
  isVersioned: boolean;
}): { status: ContentfulStatusCode; body: ErrorResponseBody } {
  // 1. HandledError-like errors
  if (isHandledErrorLike(err)) {
    const serialized = err.serialize();
    const status = serialized.httpStatus as ContentfulStatusCode;
    return finalizeErrorResponse({
      status,
      isVersioned,
      body: {
        code: serialized.code,
        message: err.message ?? serialized.code,
        meta: serialized.meta,
        reasons: serialized.reasons,
        traceId: serialized.traceId,
        spanId: serialized.spanId,
        ...(serialized.traceUrl ? { traceUrl: serialized.traceUrl } : {}),
      },
    });
  }

  // 2. ZodError
  if (err instanceof ZodError) {
    const payload = zodErrorToPayload(err);
    const status: ContentfulStatusCode = 422;
    return finalizeErrorResponse({
      status,
      isVersioned,
      body: {
        code: payload.code,
        message: payload.message,
        reasons: payload.reasons,
      },
    });
  }

  // 3. Error with `status` property (e.g. Hono HTTPException)
  const errObj = err as Record<string, unknown>;
  if (err instanceof Error && typeof errObj["status"] === "number") {
    const status = errObj["status"] as ContentfulStatusCode;
    return finalizeErrorResponse({
      status,
      isVersioned,
      body: { code: "http_error", message: err.message },
    });
  }

  // 4. Unknown errors -- 500
  const isDev =
    typeof process !== "undefined" &&
    process.env?.["NODE_ENV"] === "development";
  const message =
    isDev && err instanceof Error ? err.message : "Internal server error";
  const status: ContentfulStatusCode = 500;
  return finalizeErrorResponse({
    status,
    isVersioned,
    body: { code: "internal_error", message },
  });
}

// ---------------------------------------------------------------------------
// Hono onError handler
// ---------------------------------------------------------------------------

/**
 * Creates the `app.onError(...)` handler for the service framework.
 *
 * Reads `c.get("isVersionedRequest")` to decide the response format.
 */
export function createErrorHandler(): (
  err: Error,
  c: Context,
) => Response | Promise<Response> {
  return (err: Error, c: Context) => {
    const isVersioned = c.get("isVersionedRequest") === true;
    const { status, body } = formatError({ err, isVersioned });
    return c.json(body, status);
  };
}

export { formatError, isHandledErrorLike as isHandledErrorLike, zodErrorToPayload };
