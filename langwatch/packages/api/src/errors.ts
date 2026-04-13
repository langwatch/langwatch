import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";

import { httpStatusText } from "./types.js";

// ---------------------------------------------------------------------------
// Duck-typed interfaces for DomainError (no imports from langwatch app)
// ---------------------------------------------------------------------------

/**
 * Shape that a DomainError-like object must satisfy for the framework error
 * handler to use its `serialize()` output.
 *
 * We duck-type rather than import so this package stays standalone.
 */
interface DomainErrorLike {
  kind: string;
  message: string;
  httpStatus: number;
  meta: Record<string, unknown>;
  serialize(): {
    kind: string;
    meta: Record<string, unknown>;
    telemetry?: { traceId?: string; spanId?: string };
    httpStatus: number;
    reasons: Array<{ kind: string; meta?: Record<string, unknown>; reasons?: unknown[] }>;
  };
}

function isDomainErrorLike(err: unknown): err is DomainErrorLike {
  if (typeof err !== "object" || err === null) return false;
  const obj = err as Record<string, unknown>;
  return (
    typeof obj["kind"] === "string" &&
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
  kind: "validation_error";
  message: string;
  reasons: ValidationReason[];
  httpStatus: 422;
}

function zodErrorToPayload(err: ZodError): ValidationErrorPayload {
  return {
    kind: "validation_error",
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
  kind: string;
  message: string;
  meta?: Record<string, unknown>;
  reasons?: unknown[];
  telemetry?: { traceId?: string; spanId?: string };
}

/**
 * Formats an error into a JSON response body + status code.
 *
 * @param isVersioned - Whether the request was made through a versioned path.
 *   Versioned requests get the new format only; unversioned get a union
 *   format that includes the legacy `error` field.
 */
function formatError(
  err: unknown,
  isVersioned: boolean,
): { status: ContentfulStatusCode; body: ErrorResponseBody } {
  // 1. DomainError-like errors
  if (isDomainErrorLike(err)) {
    const serialized = err.serialize();
    const status = serialized.httpStatus as ContentfulStatusCode;
    const body: ErrorResponseBody = {
      kind: serialized.kind,
      message: err.message ?? serialized.kind,
      meta: serialized.meta,
      reasons: serialized.reasons,
      telemetry: serialized.telemetry,
    };
    if (!isVersioned) {
      body.error = httpStatusText(status);
    }
    return { status, body };
  }

  // 2. ZodError
  if (err instanceof ZodError) {
    const payload = zodErrorToPayload(err);
    const status: ContentfulStatusCode = 422;
    const body: ErrorResponseBody = {
      kind: payload.kind,
      message: payload.message,
      reasons: payload.reasons,
    };
    if (!isVersioned) {
      body.error = httpStatusText(status);
    }
    return { status, body };
  }

  // 3. Error with `status` property (e.g. Hono HTTPException)
  const errObj = err as Record<string, unknown>;
  if (err instanceof Error && typeof errObj["status"] === "number") {
    const status = errObj["status"] as ContentfulStatusCode;
    const body: ErrorResponseBody = {
      kind: "http_error",
      message: err.message,
    };
    if (!isVersioned) {
      body.error = httpStatusText(status);
    }
    return { status, body };
  }

  // 4. Unknown errors -- 500
  const isDev = typeof process !== "undefined" && process.env?.["NODE_ENV"] === "development";
  const message = isDev && err instanceof Error ? err.message : "Internal server error";
  const status: ContentfulStatusCode = 500;
  const body: ErrorResponseBody = {
    kind: "internal_error",
    message,
  };
  if (!isVersioned) {
    body.error = httpStatusText(status);
  }
  return { status, body };
}

// ---------------------------------------------------------------------------
// Hono onError handler
// ---------------------------------------------------------------------------

/**
 * Creates the `app.onError(...)` handler for the service framework.
 *
 * Reads `c.get("isVersionedRequest")` to decide the response format.
 */
export function createErrorHandler(): (err: Error, c: Context) => Response | Promise<Response> {
  return (err: Error, c: Context) => {
    const isVersioned = c.get("isVersionedRequest") === true;
    const { status, body } = formatError(err, isVersioned);
    return c.json(body, status);
  };
}

export { formatError, isDomainErrorLike, zodErrorToPayload };
