import {
  HandledError,
  isZodLikeError,
  serializedHandledErrorSchema,
  ValidationError,
  type ZodLikeError,
} from "@langwatch/handled-error";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

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

export class ProjectInputMismatchError extends HandledError {
  constructor() {
    super(
      "project_input_mismatch",
      "The requested project is not the project authorized for this request",
      { httpStatus: 403 },
    );
    this.name = "ProjectInputMismatchError";
  }
}

export class AuthenticatedActorRequiredError extends HandledError {
  constructor() {
    super("authenticated_actor_required", "This operation requires a credential bound to a user", {
      httpStatus: 403,
    });
    this.name = "AuthenticatedActorRequiredError";
  }
}

export class ApiVersionConflictError extends HandledError {
  constructor() {
    super("api_version_conflict", "The API version in the URL and header must match", {
      httpStatus: 400,
    });
    this.name = "ApiVersionConflictError";
  }
}

export class InvalidApiVersionError extends HandledError {
  constructor(expected = "latest or a real date in YYYY-MM-DD form") {
    super("invalid_api_version", `The API version must be ${expected}`, { httpStatus: 400 });
    this.name = "InvalidApiVersionError";
  }
}

export class ApiVersionUnavailableError extends HandledError {
  constructor() {
    super("api_version_unavailable", "The requested API version is not available", {
      httpStatus: 404,
    });
    this.name = "ApiVersionUnavailableError";
  }
}

export class EndpointWithdrawnError extends HandledError {
  constructor() {
    super("endpoint_withdrawn", "This endpoint has been removed", { httpStatus: 410 });
    this.name = "EndpointWithdrawnError";
  }
}

export class RateLimitedError extends HandledError {
  constructor() {
    super("rate_limited", "Too many requests", { httpStatus: 429, retryable: true });
    this.name = "RateLimitedError";
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
 *
 * Typed `ZodLikeError`, not `ZodError`: routes mounted on this app validate
 * with whichever zod their schema was authored against, and the repo now runs
 * both majors. `issue.code`, `issue.path` and `issue.message` are identical
 * across them, so the reasons this builds are too.
 */
function validationErrorFromZod(err: ZodLikeError): ValidationError {
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
  code: string;
  /**
   * Always equal to `code`. The Go envelope calls the discriminant `type`
   * (OpenAI-compatible — see pkg/herr/http.go), so both names are emitted here
   * too: a consumer can read whichever its transport taught it and get the
   * same answer either way.
   */
  type?: string;
  /**
   * @deprecated Back-compat alias of `code`, emitted during the
   * `DomainError` → `HandledError` transition so clients still reading the old
   * `kind` discriminant keep working. Read `code` in new code; removed once no
   * consumer reads `kind`.
   */
  kind?: string;
  message: string;
  retryable: boolean;
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
}: {
  status: ContentfulStatusCode;
  body: ErrorResponseBody;
}): { status: ContentfulStatusCode; body: ErrorResponseBody } {
  // Emit the deprecated `kind` alias alongside `code` so clients still reading
  // the old discriminant keep working through the transition. See
  // ErrorResponseBody.kind. `type` mirrors the Go envelope's name for the same
  // value — see ErrorResponseBody.type.
  body.kind = body.code;
  body.type = body.code;
  return { status, body };
}

function handledErrorToResponse({ err }: { err: HandledError }): {
  status: ContentfulStatusCode;
  body: ErrorResponseBody;
} {
  let serialized: ReturnType<typeof HandledError.serializeTrusted>;
  try {
    const candidate = HandledError.serializeTrusted(err);
    const json = JSON.stringify(candidate);
    if (json === void 0) {
      return internalErrorResponse();
    }
    const wire: unknown = JSON.parse(json);
    const parsed = serializedHandledErrorSchema.safeParse(wire);
    if (!parsed.success) {
      return internalErrorResponse();
    }
    serialized = parsed.data;
  } catch {
    return internalErrorResponse();
  }

  const status = serialized.httpStatus;
  if (!validHttpStatus(status)) {
    return internalErrorResponse();
  }

  return finalizeErrorResponse({
    status,
    body: {
      code: serialized.code,
      // The code, never `err.message`. A HandledError's message is server copy
      // and the body is externally visible. Trusted handled metadata remains
      // lossless; untrusted exceptions never reach this branch.
      message: serialized.code,
      retryable: serialized.retryable,
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
 * There is exactly one error format (ADR 002 §5): the version-gated union
 * envelope carrying the legacy `error` field died with the bare alias that
 * justified it.
 */
function formatError({ err }: { err: unknown }): {
  status: ContentfulStatusCode;
  body: ErrorResponseBody;
} {
  // 1. Handled errors -- the domain's own vocabulary, safe to show a caller.
  if (isTrustedHandledError(err)) {
    return handledErrorToResponse({ err });
  }

  // 2. ZodError -- promoted to a ValidationError so it travels the same path.
  //    Matched by shape so portable contracts do not depend on the identity of
  //    the particular Zod runtime instance that created the error.
  if (isZodLikeError(err)) {
    return handledErrorToResponse({
      err: validationErrorFromZod(err),
    });
  }

  // 3. Error with `status` property (e.g. Hono HTTPException). Its message is
  // untrusted: an adapter may put a downstream response body in it.
  const errObj = err as Record<string, unknown>;
  if (err instanceof Error && typeof errObj.status === "number") {
    const status = validHttpStatus(errObj.status) ? errObj.status : 500;
    return finalizeErrorResponse({
      status,
      body: {
        code: status >= 500 ? "internal_error" : "http_error",
        message: status >= 500 ? "internal_error" : "http_error",
        retryable: false,
      },
    });
  }

  // 4. Unknown errors -- 500
  return internalErrorResponse();
}

function internalErrorResponse(): {
  status: ContentfulStatusCode;
  body: ErrorResponseBody;
} {
  const status: ContentfulStatusCode = 500;
  return finalizeErrorResponse({
    status,
    body: {
      code: "internal_error",
      message: "An unknown error occurred",
      retryable: false,
    },
  });
}

function isTrustedHandledError(error: unknown): error is HandledError {
  return HandledError.isHandled(error);
}

function validHttpStatus(value: number): value is ContentfulStatusCode {
  return Number.isInteger(value) && value >= 400 && value <= 599;
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
 * Records the error it sent plus the status it sent it as on the context, so
 * the request logger reports what the caller actually received.
 *
 * This handler does not log. `loggerMiddleware` writes exactly one error
 * record per failed request, from the resolved pair published here — a second
 * record from this side would double every error-log-derived alert and count.
 */
export function createErrorHandler(): (err: Error, c: Context) => Response | Promise<Response> {
  return (err: Error, c: Context) => {
    // Promote first so the response and the log agree on one error. Reporting
    // the raw ZodError would log it as unhandled, at `error`, against the 500
    // it no longer is.
    const effective = isZodLikeError(err) ? validationErrorFromZod(err) : err;
    const { status, body } = formatError({ err: effective });

    const resolved: ResolvedError = {
      status,
      error: effective,
      ...(isTrustedHandledError(effective) && effective.traceId
        ? { traceId: effective.traceId }
        : {}),
    };
    c.set(RESOLVED_ERROR, resolved);

    return c.json(body, status);
  };
}

export { formatError, isTrustedHandledError, SchemaFailure, validationErrorFromZod };
