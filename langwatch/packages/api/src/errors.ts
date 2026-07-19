import { createLogger, type Logger } from "@langwatch/observability";
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
      message: err.message ?? serialized.code,
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
// Logging
// ---------------------------------------------------------------------------

/**
 * The Hono context key holding the status the error handler actually sent.
 *
 * The request logger would otherwise re-derive the status from the error, and
 * disagree with the response whenever the two encodings differ. Writing it
 * down once removes the guesswork.
 */
export const RESOLVED_ERROR_STATUS = "resolvedErrorStatus";

/**
 * Logs a failed request from inside the error handler.
 *
 * Handled errors are the domain speaking on purpose, so they log by fault
 * attribution — a customer's bad input is a `warn`, our own or a provider's
 * breakage is an `error`. Anything unhandled is a bug and always logs at
 * `error` with its cause, because the response deliberately flattens it to
 * "An unknown error occurred" and that is the only place the stack survives.
 *
 * Request bodies are never logged: automation `actionParams` carry encrypted
 * webhook headers and Slack tokens.
 */
function logError({
  logger,
  err,
  status,
  c,
}: {
  logger: Logger;
  err: unknown;
  status: ContentfulStatusCode;
  c: Context;
}): void {
  const base = {
    method: c.req.method,
    url: c.req.path,
    statusCode: status,
  };

  if (HandledError.isHandled(err)) {
    const level = err.fault === "customer" ? "warn" : "error";
    logger[level](
      {
        ...base,
        handledErrorCode: err.code,
        handledErrorFault: err.fault,
        ...(err.traceId ? { traceId: err.traceId } : {}),
      },
      "handled error on request",
    );
    return;
  }

  logger.error({ ...base, error: err }, "unhandled error on request");
}

// ---------------------------------------------------------------------------
// Hono onError handler
// ---------------------------------------------------------------------------

/**
 * Creates the `app.onError(...)` handler for the service framework.
 *
 * Reads `c.get("isVersionedRequest")` to decide the response format, logs the
 * failure, and records the status it sent on the context so the request logger
 * reports what the caller actually received.
 */
export function createErrorHandler(options?: {
  logger?: Logger;
  name?: string;
}): (err: Error, c: Context) => Response | Promise<Response> {
  const logger =
    options?.logger ??
    createLogger(`langwatch:api:${options?.name ?? "hono"}:errors`);

  return (err: Error, c: Context) => {
    const isVersioned = c.get("isVersionedRequest") === true;
    // Promote first so the response and the log agree on one error. Logging
    // the raw ZodError would report it as unhandled, at `error`, against the
    // 500 it no longer is.
    const effective = err instanceof ZodError ? validationErrorFromZod(err) : err;
    const { status, body } = formatError({ err: effective, isVersioned });

    logError({ logger, err: effective, status, c });
    c.set(RESOLVED_ERROR_STATUS, status);

    return c.json(body, status);
  };
}

export { formatError, validationErrorFromZod, SchemaFailure };
