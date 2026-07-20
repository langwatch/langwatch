import { HandledError, ValidationError } from "@langwatch/handled-error";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";

import { httpStatusText } from "./types.js";

// ---------------------------------------------------------------------------
// Zod error mapping
// ---------------------------------------------------------------------------

/**
 * One Zod issue, as a reason on the surrounding `ValidationError`.
 *
 * `ValidationError.fromZodError` in the shared package flattens to
 * `meta.fieldErrors` / `meta.formErrors`, which loses the per-issue `type`.
 * This package's documented wire contract is a `reasons` array of
 * `schema_failure` entries (see the README), so we build the reasons
 * ourselves and keep that shape. Because `serializeReason` renders any
 * `HandledError` child, the emitted entry gains `kind` and `fault` on top of
 * the `code` + `meta` clients already read — additive, not breaking.
 */
class SchemaFailure extends HandledError {
  constructor(meta: { field: string; type: string; message: string }) {
    super("schema_failure", meta.message, { meta, httpStatus: 422 });
    this.name = "SchemaFailure";
  }
}

/**
 * Converts a `ZodError` into a `ValidationError` — a real `HandledError`, so
 * it carries `httpStatus: 422` and `fault: "customer"`.
 *
 * That matters beyond tidiness: request logging derives both its status code
 * and its level from the error itself (`getStatusCodeFromError` /
 * `getLogLevelForRequest`). A bare `ZodError` has neither `httpStatus` nor
 * `fault`, so it was logged as a 500 `error` while the response went out 422 —
 * validation noise landing in the 5xx error budget.
 */
function validationErrorFromZod(err: ZodError): ValidationError {
  return new ValidationError("Validation error", {
    reasons: err.issues.map(
      (issue) =>
        new SchemaFailure({
          field: issue.path.join(".") || "(root)",
          type: issue.code,
          message: issue.message,
        }),
    ),
  });
}

// ---------------------------------------------------------------------------
// Error response formatting
// ---------------------------------------------------------------------------

interface ErrorResponseBody {
  /** Present only for unversioned (backwards-compat) responses. */
  error?: string;
  code: string;
  /**
   * @deprecated Back-compat alias of `code`, emitted during the
   * `DomainError` → `HandledError` transition so clients still reading the old
   * `kind` discriminant keep working. Read `code` in new code; removed once no
   * consumer reads `kind`.
   */
  kind?: string;
  message: string;
  meta?: Record<string, unknown>;
  reasons?: unknown[];
  traceId?: string;
  spanId?: string;
  traceUrl?: string;
  fault?: string;
  tips?: readonly string[];
  docsUrl?: string;
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
  // Emit the deprecated `kind` alias alongside `code` so clients still reading
  // the old discriminant keep working through the transition. See
  // ErrorResponseBody.kind.
  body.kind = body.code;
  return { status, body };
}

function handledErrorToResponse({
  err,
  isVersioned,
}: {
  err: HandledError;
  isVersioned: boolean;
}): { status: ContentfulStatusCode; body: ErrorResponseBody } {
  const serialized = err.serialize();
  return finalizeErrorResponse({
    status: serialized.httpStatus as ContentfulStatusCode,
    isVersioned,
    body: {
      code: serialized.code,
      // The code, never `err.message`. A HandledError's message is server copy
      // — it can name env vars, hostnames or internal services (ADR-045) — and
      // this body goes to external API callers. Consumers that need prose read
      // `tips` / `docsUrl`, which are authored for exactly that.
      message: serialized.code,
      meta: serialized.meta,
      reasons: serialized.reasons,
      traceId: serialized.traceId,
      spanId: serialized.spanId,
      ...(serialized.traceUrl ? { traceUrl: serialized.traceUrl } : {}),
      ...(serialized.fault ? { fault: serialized.fault } : {}),
      ...(serialized.tips?.length ? { tips: serialized.tips } : {}),
      ...(serialized.docsUrl ? { docsUrl: serialized.docsUrl } : {}),
    },
  });
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
  // 1. Handled errors -- the domain's own vocabulary, safe to show a caller.
  if (HandledError.isHandled(err)) {
    return handledErrorToResponse({ err, isVersioned });
  }

  // 2. ZodError -- promoted to a ValidationError so it travels the same path.
  if (err instanceof ZodError) {
    return handledErrorToResponse({
      err: validationErrorFromZod(err),
      isVersioned,
    });
  }

  // 3. Error with `status` property (e.g. Hono HTTPException)
  const errObj = err as Record<string, unknown>;
  if (err instanceof Error && typeof errObj["status"] === "number") {
    const status = errObj["status"] as ContentfulStatusCode;
    return finalizeErrorResponse({
      status,
      isVersioned,
      body: {
        code: status >= 500 ? "internal_error" : "http_error",
        message: status >= 500 ? "An unknown error occurred" : err.message,
      },
    });
  }

  // 4. Unknown errors -- 500
  const status: ContentfulStatusCode = 500;
  return finalizeErrorResponse({
    status,
    isVersioned,
    body: { code: "internal_error", message: "An unknown error occurred" },
  });
}

// ---------------------------------------------------------------------------
// Resolved-error handoff to the request logger
// ---------------------------------------------------------------------------

/**
 * The Hono context key holding what the error handler actually resolved: the
 * status it sent, and the error it sent it for.
 *
 * The request logger owns the single error record for a failed request, but on
 * its own it can only see the raw thrown value and has to re-derive a status
 * from it. Both guesses are wrong whenever the handler promoted the error: a
 * `ZodError` has no `httpStatus`, so the logger would report a 500 the caller
 * never received, against an error the response no longer describes. Writing
 * the resolved pair down once removes the guesswork — and keeps the handler
 * from logging a second, competing copy.
 */
export const RESOLVED_ERROR = "resolvedError";

/**
 * What {@link createErrorHandler} publishes for the request logger to consume.
 *
 * Request bodies are deliberately absent: automation `actionParams` carry
 * encrypted webhook headers and Slack tokens.
 */
export interface ResolvedError {
  status: ContentfulStatusCode;
  error: unknown;
  traceId?: string;
}

// ---------------------------------------------------------------------------
// Hono onError handler
// ---------------------------------------------------------------------------

/**
 * Creates the `app.onError(...)` handler for the service framework.
 *
 * Reads `c.get("isVersionedRequest")` to decide the response format, and
 * records the error it sent plus the status it sent it as on the context, so
 * the request logger reports what the caller actually received.
 *
 * This handler does not log. `loggerMiddleware` writes exactly one error
 * record per failed request, from the resolved pair published here — a second
 * record from this side would double every error-log-derived alert and count.
 */
export function createErrorHandler(): (
  err: Error,
  c: Context,
) => Response | Promise<Response> {
  return (err: Error, c: Context) => {
    const isVersioned = c.get("isVersionedRequest") === true;
    // Promote first so the response and the log agree on one error. Reporting
    // the raw ZodError would log it as unhandled, at `error`, against the 500
    // it no longer is.
    const effective = err instanceof ZodError ? validationErrorFromZod(err) : err;
    const { status, body } = formatError({ err: effective, isVersioned });

    const resolved: ResolvedError = {
      status,
      error: effective,
      ...(HandledError.isHandled(effective) && effective.traceId
        ? { traceId: effective.traceId }
        : {}),
    };
    c.set(RESOLVED_ERROR, resolved);

    return c.json(body, status);
  };
}

export { formatError, validationErrorFromZod, SchemaFailure };
