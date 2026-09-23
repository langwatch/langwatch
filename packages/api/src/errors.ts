import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  HandledError,
  isZodLikeError,
  remediation,
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
 * One Zod issue as a reason on the surrounding `ValidationError`. Flattening loses the per-issue
 * `type`, so we build reasons ourselves to preserve the schema_failure shape in the wire contract.
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

/**
 * The request named a scope its credential did not resolve to. `meta` carries the field name
 * so a client can mark the offending input; which organization or team the credential covers
 * is the question the refusal exists to withhold.
 */
export class ScopeInputMismatchError extends HandledError {
  constructor(scope: string) {
    super(
      "scope_input_mismatch",
      "The requested scope is not the scope authorized for this request",
      { httpStatus: 403, meta: { field: scope } },
    );

    this.name = "ScopeInputMismatchError";
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

/**
 * The body passed the cap the route declared. The caller can act on it — send
 * less — and the cap itself is documented on the operation, so nothing about
 * the limit belongs on the wire.
 */
export class PayloadTooLargeError extends HandledError {
  constructor() {
    super("payload_too_large", "The request body is larger than this endpoint accepts", {
      httpStatus: 413,
    });

    this.name = "PayloadTooLargeError";
  }
}

export class RateLimitedError extends HandledError {
  constructor() {
    super("rate_limited", "Too many requests", { httpStatus: 429, retryable: true });
    this.name = "RateLimitedError";
  }
}

export class EnterprisePlanRequiredError extends HandledError {
  constructor() {
    super("enterprise_plan_required", "This operation requires an Enterprise plan", {
      httpStatus: 402,
      fault: "customer",
      ...remediation("enterprise_plan_required"),
    });

    this.name = "EnterprisePlanRequiredError";
  }
}

/**
 * Converts a `ZodError` into a `ValidationError` (a `HandledError` with `httpStatus: 422`
 * and `fault: "customer"`). Needed for logging: a bare `ZodError` was logged as 500 error
 * while the response went out 422, landing validation noise in the 5xx error budget.
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
  /** Always equal to `code`; retained for the OpenAI-compatible Go envelope. */
  type?: string;
  /**
   * @deprecated Back-compat alias of `code`, emitted during the
   * DomainError → HandledError transition; read `code` in new code.
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

/** Formats an error using the single version-gated envelope (ADR 002 §5). */
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
 * The Hono context key holding what the error handler resolved: status and error.
 * The request logger must not re-derive the status from the raw value (both guesses
 * are wrong when the handler promoted the error). Writing the resolved pair removes guesswork.
 */
export const RESOLVED_ERROR = "resolvedError";

/**
 * What {@link createErrorHandler} publishes for the request logger to consume.
 * Request bodies are deliberately absent: automation `actionParams` carry encrypted secrets.
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
 * Creates the `app.onError(...)` handler for the service framework. Records the error and
 * status on the context so the request logger reports what the caller received. Does not log
 * itself; `loggerMiddleware` writes exactly one error record per failed request.
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

// What a surface answers a credential it will not accept: one class per code, and the sentences are
// wire (SDK error copy quotes them).

/**
 * The sentence an unauthenticated caller of a project family receives. It names all three accepted
 * credential shapes because that is what it has always named.
 */
export const MISSING_PROJECT_CREDENTIAL_MESSAGE =
  "Authentication token is required. Use X-Auth-Token header, Authorization: Bearer token, or Authorization: Basic base64(projectId:token).";

export const INVALID_PROJECT_CREDENTIAL_MESSAGE = "Invalid auth token.";

/** No credential at all reached a project surface. */
export class ProjectMissingCredentialsError extends HandledError {
  declare readonly code: "missing_credentials";

  constructor() {
    super("missing_credentials", MISSING_PROJECT_CREDENTIAL_MESSAGE, {
      httpStatus: 401,
      fault: "customer",
    });

    this.name = "ProjectMissingCredentialsError";
  }
}

/** The token reached a project surface and stands for nothing this deployment knows. */
export class ProjectInvalidCredentialsError extends HandledError {
  declare readonly code: "invalid_credentials";

  constructor() {
    super("invalid_credentials", INVALID_PROJECT_CREDENTIAL_MESSAGE, {
      httpStatus: 401,
      fault: "customer",
    });

    this.name = "ProjectInvalidCredentialsError";
  }
}

/** No credential at all reached an organization surface. */
export class OrganizationMissingCredentialsError extends HandledError {
  declare readonly code: "missing_credentials";

  constructor() {
    super("missing_credentials", "Authentication required. Use Authorization: Bearer <api-key>.", {
      httpStatus: 401,
      fault: "customer",
    });

    this.name = "OrganizationMissingCredentialsError";
  }
}

/** A PROJECT key was presented at an organization surface: a different mistake. */
export class OrganizationCredentialClassMismatchError extends HandledError {
  declare readonly code: "credential_class_mismatch";

  constructor() {
    super(
      "credential_class_mismatch",
      "This endpoint requires an organization API key, and a project key was presented.",
      { httpStatus: 401, fault: "customer" },
    );

    this.name = "OrganizationCredentialClassMismatchError";
  }
}

/** The token reached the surface and stands for nothing this deployment knows. */
export class OrganizationInvalidCredentialsError extends HandledError {
  declare readonly code: "invalid_credentials";

  constructor() {
    super("invalid_credentials", "Invalid credentials.", { httpStatus: 401, fault: "customer" });
    this.name = "OrganizationInvalidCredentialsError";
  }
}

/**
 * The credential resolved, and the tenant behind it is gone. Answered as a 401
 * rather than a 404: which organizations exist is not something an unaccepted
 * credential gets to learn.
 */
export class OrganizationNotFoundForCredentialError extends HandledError {
  declare readonly code: "organization_not_found";

  constructor() {
    super("organization_not_found", "Organization not found", {
      httpStatus: 401,
      fault: "customer",
    });

    this.name = "OrganizationNotFoundForCredentialError";
  }
}

/** The lookup behind the surface broke. The caller learns nothing of the cause. */
export class OrganizationAuthenticationUnavailableError extends HandledError {
  declare readonly code: "internal_error";

  constructor() {
    super("internal_error", "Authentication service error", {
      httpStatus: 500,
      fault: "platform",
    });

    this.name = "OrganizationAuthenticationUnavailableError";
  }
}

/** The credential is accepted and does not hold what the route asked for. */
export class OrganizationPermissionError extends HandledError {
  constructor(permission: AuthzPermission) {
    super("insufficient_permissions", `Insufficient permissions. Required: ${permission}`, {
      httpStatus: 403,
      fault: "customer",
    });

    this.name = "OrganizationPermissionError";
  }
}

/**
 * A surface this deployment opened with no verifier behind it, or a credential
 * it refused. It fails CLOSED: the request is refused, and the refusal names
 * the surface rather than letting an unverified caller through.
 */
export class SurfaceUnverifiedError extends HandledError {
  constructor(surface: string) {
    super("unauthorized", "Authentication required", {
      httpStatus: 401,
      fault: "customer",
      meta: { surface },
    });

    this.name = "SurfaceUnverifiedError";
  }
}

/** The route is served and this deployment composed nothing behind it. */
export class SurfaceCapabilityUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `This deployment has no ${capability}.`, {
      httpStatus: 503,
      fault: "platform",
    });

    this.name = "SurfaceCapabilityUnavailableError";
  }
}

/**
 * A bearer whose secret this deployment did not configure. 404 rather than 401:
 * whether this deployment holds a given secret is not something a caller
 * presenting the wrong one gets to learn.
 */
export class SurfaceUnconfiguredError extends HandledError {
  constructor(surface: string) {
    super("not_found", "Not found", { httpStatus: 404, fault: "customer", meta: { surface } });
    this.name = "SurfaceUnconfiguredError";
  }
}

/**
 * A bearer whose secret this deployment named and left blank: not an absent
 * one, which the 404 above is for, but a mis-set key, said out loud.
 */
export class SurfaceBlankSecretError extends HandledError {
  declare readonly code: "internal_error";

  constructor(surface: string) {
    super("internal_error", "This deployment is misconfigured.", {
      httpStatus: 500,
      fault: "platform",
      meta: { surface },
    });

    this.name = "SurfaceBlankSecretError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The subscription lane's own refusals. All three are the same claim from three
// angles: the lane streams SUBSCRIPTIONS opened by this application's own
// pages, and nothing else.
// ─────────────────────────────────────────────────────────────────────────────

/** The composed router carries no procedure at the requested path. */
export class LiveStreamNotFoundError extends HandledError {
  declare readonly code: "live_stream_not_found";

  constructor() {
    super("live_stream_not_found", "No live update channel is served at that path.", {
      httpStatus: 404,
      fault: "customer",
    });

    this.name = "LiveStreamNotFoundError";
  }
}

/**
 * The path names a real procedure, but a query or a mutation.
 */
export class LiveStreamUnsupportedProcedureError extends HandledError {
  declare readonly code: "live_stream_unsupported_procedure";

  constructor() {
    super(
      "live_stream_unsupported_procedure",
      "Only subscriptions are served on the live update channel; call this procedure over the tRPC endpoint instead.",
      { httpStatus: 405, fault: "customer" },
    );

    this.name = "LiveStreamUnsupportedProcedureError";
  }
}

/** The request did not originate from this application's own origin. */
export class LiveStreamCrossSiteBlockedError extends HandledError {
  declare readonly code: "live_stream_cross_site_blocked";

  constructor() {
    super(
      "live_stream_cross_site_blocked",
      "A live update channel can only be opened from this application's own pages.",
      { httpStatus: 403, fault: "customer" },
    );

    this.name = "LiveStreamCrossSiteBlockedError";
  }
}
