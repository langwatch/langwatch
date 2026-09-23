import type { Actor } from "@langwatch/actor";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { HandledError, type SerializedReason } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { INVALID_TRACE_ID } from "@langwatch/observability/constants";
import { nowInstant, toEpochMs } from "@langwatch/time";
import { trace } from "@opentelemetry/api";
import type { Context, ErrorHandler } from "hono";
import { resolver, type DescribeRouteOptions } from "hono-openapi";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z, type ZodType } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// The request-context keys every layer of the transport reads off.
// ─────────────────────────────────────────────────────────────────────────────

/** Context key holding the endpoint a request matched, as `METHOD /path`. */
export const ENDPOINT_ROUTE = "endpointRoute" as const;

/** Context key holding the complete validated input passed to a handler. */
export const ENDPOINT_INPUT = "endpointInput" as const;

/** Context key holding the family that actually resolved the request. */
export const REQUEST_FAMILY = "requestFamily" as const;

/**
 * Context key marking that a request log record is already owed for this request. See
 * {@link REQUEST_FAMILY}: without it, a request through every mounted family would write
 * one identical log line per family. The outermost family owns the record; the rest stand down.
 */
export const REQUEST_LOG_CLAIM = "requestLogClaim" as const;

/**
 * Context key marking that the status on the wire is one the route DECLARED as
 * an answer. An unhealthy platform report is the endpoint working, so the
 * request record says `info` rather than counting a 503 as a server fault.
 */
export const DECLARED_ANSWER = "declaredAnswer" as const;

// ─────────────────────────────────────────────────────────────────────────────
// The handler's own context, and the documentation shape a family hands over.
// ─────────────────────────────────────────────────────────────────────────────

/** The context variables every handler can read. */
export type EndpointVariables = {
  // Validated at runtime by the declared SSE query schema; inference from
  // the trailing define callback is not expressible in TypeScript.
  query?: any;
};

/** Authenticated principal exposed directly to handlers. */
export type RequestActor = Actor;

/** The Hono context a family's handler receives, with typed variables. */
export type ServiceContext<
  TVariables extends Record<string, unknown> = EndpointVariables,
  TApp = unknown,
> = Context<{ Variables: TVariables }> & {
  readonly app: TApp;
  actor(): RequestActor;
  authorize(permission: AuthzPermission): Promise<void>;
};

/** OpenAPI documentation for one endpoint. */
export interface EndpointDocs {
  /** Short summary shown next to the operation in the reference. */
  summary?: string;
  /** Long-form description of the operation. */
  description?: string;
  /** Tags used to group the operation in the reference. */
  tags?: string[];
  /**
   * Explicit operation id for the `latest` mount. Set it on every documented
   * endpoint: generated ids leak URL shapes into SDK function names. Dated
   * mounts append their version so every operation in the document is unique.
   */
  operationId?: string;
  /** Exclude the endpoint from the OpenAPI document entirely. */
  hide?: boolean;
  /** Security requirements for the operation. */
  security?: DescribeRouteOptions["security"];
  /**
   * Additional documented responses, merged over the generated success
   * response (same-status keys win).
   */
  responses?: DescribeRouteOptions["responses"];
  /**
   * Hand-written operation parameters, appended after the ones the framework
   * derives (the version header, the idempotency key).
   */
  parameters?: DescribeRouteOptions["parameters"];
  /**
   * Hand-written request body documentation, replacing whatever the framework
   * would derive. For a family whose handler validates the body itself, this
   * is the only place the published shape can come from.
   */
  requestBody?: DescribeRouteOptions["requestBody"];
}

export interface RouteResponse {
  // If the description is missing, it will break our documentations
  description: string;
  // A media type with no schema is what a route that writes its own bytes
  // publishes: the type is the whole of what it can promise.
  content: Record<string, { schema?: any }>;
  // Response headers a caller can read something from. Only worth declaring
  // for a header that carries meaning the body does not.
  headers?: Record<string, { description: string; schema: { type: "string"; enum?: string[] } }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// The answer of a route that is not the one to serve this request.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The answer a handler gives when the request is not its own after all: the caller runs
 * the next mount instead of writing a response. Only an any-method route can use it —
 * every other route was matched by method and path and owns what it matched.
 */
const DECLINED = Symbol.for("@langwatch/api/rest/declined");

/** The answer of a handler that is not the one to serve this request. */
export type Declined = { readonly [DECLINED]: true };

const DECLINED_ANSWER: Declined = Object.freeze({ [DECLINED]: true as const });

/** @see Declined */
export function declined(): Declined {
  return DECLINED_ANSWER;
}

/** Whether a handler's answer is the decline rather than a response. */
export function isDeclined(answer: unknown): answer is Declined {
  return answer === DECLINED_ANSWER;
}

// ─────────────────────────────────────────────────────────────────────────────
// The status-carrying error vocabulary the boundary throws.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * No `code`, fault or remediation: the flat legacy envelope pre-`HandledError`
 * families publish. Reach for `HandledError` when the cause is known and
 * actionable.
 */
export abstract class HttpError extends Error {
  abstract readonly status: ContentfulStatusCode;
  error: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    this.error = message;
  }
}

/** Error for 400 Bad Request responses */
export class BadRequestError extends HttpError {
  readonly status = 400;
  constructor(message = "Bad request") {
    super(message);
  }
}

/** Error for 401 Unauthorized responses */
export class UnauthorizedError extends HttpError {
  readonly status = 401;
  constructor(message = "Unauthorized") {
    super(message);
  }
}

/**
 * Error for 403 Forbidden responses: the caller is authenticated and holds the
 * permission, but the request is refused on its own merits. Use `UnauthorizedError`
 * when credentials or permission are what's missing.
 */
export class ForbiddenError extends HttpError {
  readonly status = 403;
  constructor(message = "Forbidden") {
    super(message);
  }
}

/** Error for 404 Not Found responses */
export class NotFoundError extends HttpError {
  readonly status = 404;
  constructor(message = "Not found") {
    super(message);
  }
}

/** Error for 422 Unprocessable Entity responses */
export class UnprocessableEntityError extends HttpError {
  readonly status = 422;
  constructor(message = "Unprocessable entity") {
    super(message);
  }
}

/** Error for 500 Internal Server Error responses */
export class InternalServerError extends HttpError {
  readonly status = 500;
  constructor(message = "Internal server error") {
    super(message);
  }
}

/**
 * Hono's own `HTTPException`, recognised by shape rather than `instanceof`: instanceof
 * answers false whenever the two ends resolved `hono/http-exception` to different module
 * instances, losing the refusal's status and reaching the caller as a generic 500.
 */
export function isFrameworkRefusal(
  error: unknown,
): error is Error & { status: ContentfulStatusCode; getResponse: () => Response } {
  if (!(error instanceof Error)) return false;

  const candidate = error as { status?: unknown; getResponse?: unknown };

  return typeof candidate.status === "number" && typeof candidate.getResponse === "function";
}

// ─────────────────────────────────────────────────────────────────────────────
// The wire shapes: the canonical envelope and the flat legacy one.
// ─────────────────────────────────────────────────────────────────────────────

/** Coerces a date value (ISO string or epoch number) to epoch milliseconds. */
export function coerceToEpoch(value: string | number): number {
  return toEpochMs(value);
}

/** Schema for successful operation responses */
export const successSchema = z.object({ success: z.boolean() });

/** REST error envelope; fields sit at the root rather than under `error`. */
export const apiErrorSchema = z.object({
  type: z.string(),
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  meta: z.record(z.string(), z.unknown()).optional(),
  /**
   * Correlation handles for the failing request, present when the request
   * was traced. Same field names and semantics as `herr.ErrorBody`.
   */
  trace_id: z.string().optional(),
  span_id: z.string().optional(),
  /**
   * The remediation channel: what to do about it, where it is documented,
   * and whose mistake it was.
   */
  tips: z.array(z.string()).optional(),
  docs_url: z.string().optional(),
  fault: z.enum(["customer", "platform", "provider"]).optional(),
  /**
   * The cause chain a multi-fact refusal IS — one entry per offending
   * field for a schema failure.
   */
  reasons: z.array(z.unknown()).optional(),
});

export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

/**
 * The status class each HTTP status reports as `error.type`. A status with no
 * entry reports {@link FALLBACK_API_ERROR_TYPE}.
 */
export const API_ERROR_TYPE_BY_STATUS: Record<number, string> = {
  400: "bad_request",
  401: "unauthenticated",
  403: "permission_denied",
  404: "not_found",
  409: "conflict",
  410: "gone",
  412: "precondition_failed",
  422: "unprocessable_entity",
  429: "rate_limited",
};

export const FALLBACK_API_ERROR_TYPE = "internal_error";

/** The `error.type` for a status, closed-set with an internal_error fallback. */
export function apiErrorType(status: number): string {
  return API_ERROR_TYPE_BY_STATUS[status] ?? FALLBACK_API_ERROR_TYPE;
}

/**
 * Builds the canonical envelope. `type` is derived from the status so a route
 * cannot invent a class, and empty `meta` is omitted rather than sent as `{}`.
 */
export function apiErrorBody({
  status,
  code,
  message,
  meta,
  retryable = false,
  traceId,
  spanId,
  tips,
  docsUrl,
  fault,
  reasons,
}: {
  status: number;
  code: string;
  message: string;
  meta?: Record<string, unknown>;
  retryable?: boolean;
  traceId?: string;
  spanId?: string;
  tips?: readonly string[];
  docsUrl?: string;
  fault?: "customer" | "platform" | "provider";
  reasons?: readonly SerializedReason[];
}): ApiErrorBody {
  return {
    type: apiErrorType(status),
    code,
    message,
    retryable,
    ...(meta && Object.keys(meta).length > 0 ? { meta } : {}),
    ...(traceId ? { trace_id: traceId } : {}),
    ...(spanId ? { span_id: spanId } : {}),
    ...(tips && tips.length > 0 ? { tips: [...tips] } : {}),
    ...(docsUrl ? { docs_url: docsUrl } : {}),
    ...(fault ? { fault } : {}),
    ...(reasons && reasons.length > 0 ? { reasons: [...reasons] } : {}),
  };
}

/**
 * The pre-canonical flat error shape, `{ error: "<sentence>", message? }`. Still the wire
 * shape of families that predate the canonical envelope, and of client readers written
 * against them. New routes must use {@link apiErrorSchema}.
 */
export const errorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
});

/** Schema for unauthorized error responses */
export const unauthorizedSchema = errorSchema;

/** Schema for bad request error responses */
export const badRequestSchema = errorSchema;

/** Schema for conflict error responses */
export const conflictSchema = z.object({
  ...errorSchema.shape,
  message: z.string(),
});

// ─────────────────────────────────────────────────────────────────────────────
// The documented responses a route spreads into its OpenAPI block.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The documented errors for the families that predate the canonical envelope,
 * in the flat `{ error, message? }` shape they actually emit. Do not migrate
 * this in place: the apps importing it publish that shape to live consumers.
 */
export const baseResponses: Record<number, RouteResponse> = {
  401: {
    description: "Unauthorized",
    content: {
      "application/json": { schema: resolver(unauthorizedSchema) },
    },
  },
  400: {
    description: "Bad Request",
    content: {
      "application/json": { schema: resolver(badRequestSchema) },
    },
  },
  422: {
    description: "Unprocessable Entity",
    content: {
      "application/json": { schema: resolver(errorSchema) },
    },
  },
  500: {
    description: "Internal Server Error",
    content: {
      "application/json": { schema: resolver(errorSchema) },
    },
  },
};

export const conflictResponses: Record<409, RouteResponse> = {
  409: {
    description: "Conflict",
    content: {
      "application/json": { schema: resolver(conflictSchema) },
    },
  },
};

/** One documented error body, the canonical envelope, for a given status. */
function canonicalResponse(description: string): RouteResponse {
  return {
    description,
    content: { "application/json": { schema: resolver(apiErrorSchema) } },
  };
}

/**
 * The documented errors for families that publish the canonical envelope
 * ({@link apiErrorSchema}): 400/401/500 match whichever layer refused. 422
 * is absent on purpose — validation failures answer 400 `validation_error`.
 */
export const canonicalBaseResponses: Record<number, RouteResponse> = {
  400: canonicalResponse("Bad Request"),
  401: canonicalResponse("Unauthorized"),
  403: canonicalResponse("Forbidden"),
  500: canonicalResponse("Internal Server Error"),
};

/**
 * The canonical 422, for routes that refuse a well-formed request on a
 * deliberate ceiling rather than on its shape. Kept separate so that spreading
 * it is a per-route statement that this route really can answer 422.
 */
export const canonicalUnprocessableResponses: Record<422, RouteResponse> = {
  422: canonicalResponse("Unprocessable Entity"),
};

/** The canonical 409, for families that publish the canonical envelope. */
export const canonicalConflictResponses: Record<409, RouteResponse> = {
  409: canonicalResponse("Conflict"),
};

/** The canonical 404, for routes that address one resource by id. */
export const canonicalNotFoundResponses: Record<404, RouteResponse> = {
  404: canonicalResponse("Not Found"),
};

/**
 * The documented 200 for a route that answers with one schema. One definition
 * here so a change to the success envelope reaches every family that publishes
 * one.
 */
export const buildStandardSuccessResponse = (zodSchema: ZodType): RouteResponse => {
  return {
    description: "Success",
    content: {
      "application/json": { schema: resolver(zodSchema) },
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared hardening for the routes that stream stored-object bytes back to a
// browser (`/api/files`, `/api/user-avatar`).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Static response headers attached to every stored-object read. Never vary by
 * row, never echo user content: a locked-down CSP + sandbox + nosniff so a
 * stored payload can't be interpreted as active content, and no referrer leak.
 */
export const STORED_OBJECT_RESPONSE_BASE_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Referrer-Policy": "no-referrer",
};

/**
 * Resolves the Content-Type for a stored-object response: the requested type when
 * `readbackSafe` accepts it, else `application/octet-stream` to prevent MIME-sniffing XSS.
 * The allowlist is passed in (not imported) so the ingest path applies the same predicate.
 */
export function safeMediaType({
  mediaType,
  readbackSafe,
}: {
  mediaType: string;
  readbackSafe: (mediaType: string) => boolean;
}): string {
  return readbackSafe(mediaType) ? mediaType : "application/octet-stream";
}

/**
 * RFC 6266 — keep ASCII filename-safe characters, replace anything else with
 * `_`, and cap length.
 */
export function sanitizeFilenameSegment(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 128);
}

/** A JSON response carrying the shared stored-object hardening headers. */
export function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...STORED_OBJECT_RESPONSE_BASE_HEADERS,
    },
  });
}

/**
 * A 429 response with a `Retry-After` derived from the rate-limit reset time
 * (clamped to ≥ 1s), plus the shared hardening headers.
 */
export function rateLimitedResponse(resetAtMs: number): Response {
  return new Response(JSON.stringify({ error: "rate_limited" }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(
        Math.max(1, Math.ceil((resetAtMs - nowInstant().epochMilliseconds) / 1000)),
      ),
      ...STORED_OBJECT_RESPONSE_BASE_HEADERS,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The correlation handles every canonical refusal quotes.
// ─────────────────────────────────────────────────────────────────────────────

const INVALID_SPAN_ID = "0".repeat(16);

/** An all-zero id is OpenTelemetry's "no valid span" sentinel: treat as absent. */
function liveId(id: unknown, zero: string): string | undefined {
  return typeof id === "string" && id && id !== zero ? id : undefined;
}

/**
 * The request's trace correlation handles, as set by the tracer middleware. Every
 * canonical refusal carries them, because a 5xx body deliberately says nothing about the
 * failure: quoting a trace id connects a customer's report to the log line with the detail.
 */
export function requestTraceIds(c: Context): {
  traceId?: string;
  spanId?: string;
} {
  return {
    traceId: liveId(c.get("traceId"), INVALID_TRACE_ID),
    spanId: liveId(c.get("spanId"), INVALID_SPAN_ID),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// A family's own `onError`, layered over the boundary's.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A family's `onError`, with a handled refusal's `meta.retryAfterMs` rendered as `Retry-After`
 * in whole seconds (ARCHITECTURE.md §8). The body and status are the family's, untouched, and a
 * `Retry-After` the answer already carries, the rate limiter's included, is kept.
 */
export function withRetryAfter(onError: ErrorHandler): ErrorHandler {
  return async (error, c) => {
    const answer = await onError(error, c);
    const waitMs = HandledError.isHandled(error) ? error.meta.retryAfterMs : undefined;

    const isWait = typeof waitMs === "number" && Number.isFinite(waitMs) && waitMs >= 0;
    if (!isWait || answer.headers.has("Retry-After")) return answer;

    const rendered = new Response(answer.body, answer);
    rendered.headers.set("Retry-After", String(Math.ceil(waitMs / 1000)));

    return rendered;
  };
}

/**
 * The status precedence: a family's {@link HttpError}, a handled error's own
 * status, a framework refusal's, else an internal 500.
 */
function resolveResponseStatus(error: unknown): ContentfulStatusCode {
  if (error instanceof HttpError) return error.status;

  if (HandledError.isHandled(error)) return error.httpStatus as ContentfulStatusCode;

  if (isFrameworkRefusal(error)) return error.status;

  return 500;
}

/**
 * A family's own `onError`: its domain mapping layered over the process's
 * boundary handler. Delegates anything unclaimed so a handled error keeps its
 * code/meta/reasons; only the logger's name and prefix differ between families.
 */
export function createFamilyErrorHandler(options: {
  /** e.g. `langwatch:api:api-keys:errors`. */
  loggerName: string;
  /** e.g. `API Keys Error`, the prefix on the logged sentence. */
  label: string;
  boundary: ErrorHandler;
  mapError?: (error: Error) => Error;
  headers?: (error: Error) => Readonly<Record<string, string>>;
}): ErrorHandler {
  const logger = createLogger(options.loggerName);

  return async (error, c) => {
    error = options.mapError?.(error) ?? error;

    for (const [name, value] of Object.entries(options.headers?.(error) ?? {})) {
      c.header(name, value);
    }

    // Same order as the response dispatch below, so the logged status is
    // always the status the caller received.
    const status = resolveResponseStatus(error);

    // A refusal the caller can act on is their fact, not our outage: logging
    // a 404 or a 422 at error level buries the real failures under routine ones.
    const log = status >= 500 ? logger.error : logger.warn;

    log.call(
      logger,
      {
        path: c.req.path,
        method: c.req.method,
        routeParams: c.req.param(),
        status,
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
      },
      `${options.label} [${status}]: ${error.message || String(error)}`,
    );

    if (error instanceof HttpError) {
      return c.json(errorSchema.parse(error), error.status);
    }

    // A handled error already knows its own status, code, meta, reasons and
    // remediation — collapsing it to a 500 here would throw all of that away.
    // A framework refusal carries a status the caller can act on, and the
    // boundary renders it.
    const isDomainOrFrameworkHandled = HandledError.isHandled(error) || isFrameworkRefusal(error);

    if (isDomainOrFrameworkHandled) {
      return options.boundary(error, c);
    }

    const internalError = new InternalServerError();

    return c.json(errorSchema.parse(internalError), internalError.status);
  };
}

/**
 * The code for a refusal that only knows its status. `HttpError` carries a status and a
 * sentence but no machine name, so without this a caller branching on `error.code` would
 * get nothing to branch on.
 */
const CODE_BY_STATUS: Readonly<Record<number, string>> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  412: "precondition_failed",
  422: "unprocessable_entity",
  429: "rate_limited",
};

const FALLBACK_ERROR_CODE = "internal_error";

/**
 * What a 5xx says out loud. An unexpected failure's message names Prisma models, SQL,
 * hosts and stack fragments. None of that is API copy, and the structured trace ids
 * carried alongside are the correlation channel that replaces it.
 */
const INTERNAL_ERROR_MESSAGE = "An unknown error occurred";

/**
 * One status for one code, across every family a process serves. `validation_error` is
 * pinned to 422 since it is raised at two statuses elsewhere; `malformed_request` needs
 * none — both raise sites agree on 400.
 */
const VALIDATION_ERROR_CODE = "validation_error";
const VALIDATION_ERROR_STATUS = 422;

/** One link in `meta.reasons`, in the wire's own casing. */
export interface ApiErrorReason {
  code: string;
  message: string;
  retryable: boolean;
  meta?: Record<string, unknown>;
}

function reasonsOf(error: unknown): ApiErrorReason[] {
  if (!HandledError.isHandled(error)) return [];

  return error.serialize().reasons.map((reason) => ({
    code: reason.code,
    message: typeof reason.meta?.message === "string" ? reason.meta.message : reason.code,
    retryable: reason.retryable,
    ...(reason.meta && Object.keys(reason.meta).length > 0 ? { meta: reason.meta } : {}),
  }));
}

/**
 * A status-carrying REST error, recognised by its shape rather than by its class: there
 * are two `HttpError` trees in this tree, and both answer here.
 */
function isStatusCarryingError(
  error: unknown,
): error is Error & { status: ContentfulStatusCode; error: string } {
  return (
    error instanceof Error &&
    typeof (error as { status?: unknown }).status === "number" &&
    typeof (error as { error?: unknown }).error === "string"
  );
}

/**
 * The canonical body and status for any thrown value. THE mapping — every canonical
 * family answers through it, so one code can never mean two statuses across families.
 */
export function canonicalErrorFor(
  error: unknown,
  trace?: { traceId?: string; spanId?: string },
): { status: ContentfulStatusCode; body: ApiErrorBody } {
  const traceIds = { traceId: trace?.traceId, spanId: trace?.spanId };

  if (HandledError.isHandled(error)) return handledErrorEnvelope(error, traceIds);

  if (isStatusCarryingError(error)) {
    const { status } = error;

    return {
      status,
      body: apiErrorBody({
        status,
        code: CODE_BY_STATUS[status] ?? FALLBACK_ERROR_CODE,
        message: status >= 500 ? INTERNAL_ERROR_MESSAGE : error.message,
        ...traceIds,
      }),
    };
  }

  return {
    status: 500,
    body: apiErrorBody({
      status: 500,
      code: FALLBACK_ERROR_CODE,
      message: INTERNAL_ERROR_MESSAGE,
      ...traceIds,
    }),
  };
}

/**
 * The envelope for a handled error: its own code, status, meta and reason chain below
 * 5xx; the opaque body at 5xx. A handled message is customer-safe by construction
 * (ADR-045), and customer-safe is not the same question as caller-actionable.
 */
function handledErrorEnvelope(
  error: HandledError,
  traceIds: { traceId?: string; spanId?: string },
): { status: ContentfulStatusCode; body: ApiErrorBody } {
  const isValidation = error.code === VALIDATION_ERROR_CODE;

  const status = (
    isValidation ? VALIDATION_ERROR_STATUS : (error.httpStatus ?? 500)
  ) as ContentfulStatusCode;

  if (status >= 500) {
    return {
      status,
      body: apiErrorBody({
        status,
        code: FALLBACK_ERROR_CODE,
        message: INTERNAL_ERROR_MESSAGE,
        retryable: error.retryable,
        ...traceIds,
      }),
    };
  }

  const reasons = reasonsOf(error);

  return {
    status,
    body: apiErrorBody({
      status,
      code: error.code,
      message: error.message ?? "",
      retryable: error.retryable,
      meta: { ...error.meta, ...(reasons.length > 0 ? { reasons } : {}) },
      ...traceIds,
    }),
  };
}

/**
 * The canonical envelope for a failure with no request context to read trace
 * ids from — one that never reached, or escaped, a family's own `onError`. The
 * SAME serializer, so a client cannot tell which layer failed.
 */
export function canonicalErrorAnswer(failure: unknown): Response {
  const span = trace.getActiveSpan()?.spanContext();

  const { status, body } = canonicalErrorFor(failure, {
    ...(span && span.traceId !== INVALID_TRACE_ID ? { traceId: span.traceId } : {}),
    ...(span && span.spanId !== INVALID_SPAN_ID ? { spanId: span.spanId } : {}),
  });

  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/** Answers `error` as the canonical envelope, with the request's own trace ids. */
export function canonicalErrorResponse(error: unknown, c: Context): Response {
  const { status, body } = canonicalErrorFor(error, requestTraceIds(c));

  return c.json(body, status);
}

/**
 * A canonical-envelope family's own `onError`, layered over the shared mapping. `mapError`
 * defaults to {@link canonicalErrorFor} — the one mapping every canonical family answers
 * through — so a family that only wants its own log line states only that.
 */
export function createCanonicalFamilyErrorHandler(options: {
  /** e.g. `langwatch:api:webhooks:errors`. */
  loggerName: string;
  /** e.g. `Webhooks API Error`, the prefix on the logged sentence. */
  label: string;
  /** Overrides the canonical mapping. A family almost never needs its own. */
  mapError?: (
    error: unknown,
    c: Context<any>,
  ) => { status: ContentfulStatusCode; body: ApiErrorBody };
}): ErrorHandler {
  const logger = createLogger(options.loggerName);

  const mapError =
    options.mapError ??
    ((error: unknown, c: Context<any>) => canonicalErrorFor(error, requestTraceIds(c)));

  return async (error, c) => {
    const { status, body } = mapError(error, c);

    logger.error(
      {
        path: c.req.path,
        method: c.req.method,
        status,
        code: body.code,
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
      },
      `${options.label} [${status}]: ${error.message || String(error)}`,
    );

    return c.json(body, status);
  };
}
