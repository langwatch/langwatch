/**
 * Everything that happens to a REST request before its handler answers: the
 * validator that fails the way the boundary fails, the wire-size cap, the
 * tracer and request logger, the declared middleware facts, the typed SSE
 * stream, and the `Idempotency-Key` protocol with its receipt ledger.
 */
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";

import { HandledError, remediation } from "@langwatch/handled-error";
import {
  createLogger,
  getStatusCodeFromError,
  logHttpRequest,
} from "@langwatch/observability";
import { runWithContext, updateCurrentContext } from "@langwatch/observability/context";
import { type Instant, fromDate, nowInstant, toDate } from "@langwatch/time";
import {
  context as otContext,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import type { Context, MiddlewareHandler, Next, ValidationTargets } from "hono";
import { HTTPException } from "hono/http-exception";
import { type SSEStreamingApi, streamSSE } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { validator as openApiValidator } from "hono-openapi";
import type { z, ZodIssue, ZodSchema } from "zod";

import { RESOLVED_ERROR, type ResolvedError } from "../errors.ts";
import { parseApiSchema, type ApiSchema, type ApiSchemaOutput } from "../schema.ts";
import {
  ENDPOINT_ROUTE,
  REQUEST_FAMILY,
  REQUEST_LOG_CLAIM,
  type ServiceContext,
} from "./response.ts";

const idempotencyLogger = createLogger("langwatch:api:idempotency");

// ─────────────────────────────────────────────────────────────────────────────
// Validation.
//
// The Standard Schema validator doesn't throw on failure by default, so the
// route's `onError` (ADR-045) never runs and the whole ZodError goes on the
// wire, truncating the one actionable field. This wrapper installs the hook and
// throws a typed error instead.
// ─────────────────────────────────────────────────────────────────────────────

/** How each validation target reads in a sentence written for a human. */
const TARGET_NOUN: Record<keyof ValidationTargets, string> = {
  json: "request body",
  form: "form data",
  query: "query parameters",
  param: "path parameters",
  header: "request headers",
  cookie: "cookies",
};

/** Zod's name for "this key was not in the schema at all". */
const UNRECOGNIZED_KEYS = "unrecognized_keys";

/**
 * Deliberately not zod's own `ZodIssue`: a route validating something a
 * schema can't know (a column name, a project-owned id) reports the same
 * kind of fact in this one shape.
 */
export interface FieldViolation {
  /** Dotted path to the offending value, e.g. `series.0.metric`. */
  field: string;
  /** What sort of violation, e.g. `invalid_enum_value`, `unknown_path`. */
  type: string;
  message: string;
  /** What the field would have accepted, when that is a knowable set. */
  expected?: unknown;
  /** What it got instead. */
  received?: unknown;
}

/**
 * A reason is a HandledError like any other, so `serialize()` renders it
 * with the same shape as the error it hangs off. `meta.field` survives
 * truncation in a way a prose paragraph does not; 422 not 400 since the
 * request PARSED and the schema rejected it.
 */
export class SchemaFailure extends HandledError {
  constructor(violation: FieldViolation) {
    super("schema_failure", violation.message, {
      httpStatus: 422,
      meta: {
        field: violation.field,
        type: violation.type,
        message: violation.message,
        ...(violation.expected !== undefined ? { expected: violation.expected } : {}),
        ...(violation.received !== undefined ? { received: violation.received } : {}),
      },
    });
    this.name = "SchemaFailure";
  }
}

/**
 * Exported so a route can raise this for a check its schema couldn't
 * express, instead of an anonymous `HTTPException(400)`.
 */
export class RequestValidationError extends HandledError {
  constructor(args: { target: keyof ValidationTargets; violations: readonly FieldViolation[] }) {
    super("validation_error", `The ${TARGET_NOUN[args.target]} didn't match the expected shape.`, {
      httpStatus: 422,
      fault: "customer",
      meta: {
        target: args.target,
        // A flat list of the offending paths, so a caller that reads nothing
        // else still learns WHERE without walking the reason chain.
        fields: args.violations.map((v) => v.field),
      },
      reasons: args.violations.map((v) => new SchemaFailure(v)),
      ...remediation("validation_error"),
    });
    this.name = "RequestValidationError";
  }
}

/**
 * One refusal for a rejected request, whatever raised it — a bare zod error
 * left the status to whichever boundary happened to be installed.
 */
export function requestValidationErrorFrom({
  target,
  error,
  input,
}: {
  target: keyof ValidationTargets;
  error: unknown;
  input?: unknown;
}): RequestValidationError {
  const issues = issuesOf(error as ValidationResult["error"]);
  return new RequestValidationError({
    target,
    violations: issues.map((issue) => violationOf(issue, input)),
  });
}

/** A zod issue, read into the shape above. */
function violationOf(issue: ZodIssue, input: unknown): FieldViolation {
  return {
    field: fieldOf(issue),
    type: issue.code,
    message: issue.message,
    ...expectationOf(issue, input),
  };
}

/**
 * 400, not 422: there are no fields to name because there is no document.
 * Hono raises this as an `HTTPException` before any schema runs; this only
 * gives it a code.
 */
class MalformedRequestError extends HandledError {
  constructor(args: { target: keyof ValidationTargets; detail: string }) {
    super("malformed_request", `The ${TARGET_NOUN[args.target]} could not be parsed.`, {
      httpStatus: 400,
      fault: "customer",
      meta: { target: args.target, detail: args.detail },
      ...remediation("malformed_request"),
    });
    this.name = "MalformedRequestError";
  }
}

/**
 * The dotted path to the offending value, or `(root)` when the whole document
 * is wrong (a top-level type mismatch has an empty path).
 */
function fieldOf(issue: ZodIssue): string {
  return issue.path.length > 0 ? issue.path.join(".") : "(root)";
}

/**
 * An enum's permitted values are the most actionable fact in a validation
 * failure; as structured data they survive truncation a prose sentence didn't.
 */
function expectationOf(issue: ZodIssue, input: unknown): Record<string, unknown> {
  if (issue.code === "invalid_value") {
    // Zod stopped carrying the rejected value on this issue; read it back
    // off the raw input instead — scalars only, an object here is a shape
    // mistake that belongs in no envelope.
    const received = valueAt(input, issue.path);
    return {
      expected: [...issue.values],
      ...(isWireScalar(received) ? { received } : {}),
    };
  }
  if (issue.code === "invalid_type") {
    return { expected: issue.expected };
  }
  if (issue.code === UNRECOGNIZED_KEYS) {
    return { unrecognized: issue.keys };
  }
  // A `superRefine` issue with `params: { expected, received }` gets the
  // same structured channel enum failures get, so a caller reads ONE shape.
  if (issue.code === "custom" && issue.params) {
    const params = issue.params as Record<string, unknown>;
    return {
      ...(params.expected !== undefined ? { expected: params.expected } : {}),
      ...(params.received !== undefined ? { received: params.received } : {}),
    };
  }
  return {};
}

/** The value at a zod issue path, or undefined when the path cannot be walked. */
function valueAt(input: unknown, path: ReadonlyArray<PropertyKey>): unknown {
  let current = input;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}

function isWireScalar(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/**
 * Hono raises a malformed body as `HTTPException(400)` from inside its own
 * validator, BEFORE the schema function runs — so it cannot be caught by the
 * hook, only around the middleware.
 */
function isMalformedBody(error: unknown): error is HTTPException {
  return error instanceof HTTPException && error.status === 400;
}

/** The implementation, written against the loose runtime contract. */
function build(
  target: keyof ValidationTargets,
  schema: ZodSchema,
  hook?: (result: unknown, c: unknown) => unknown,
): MiddlewareHandler {
  const validate = openApiValidator(target, schema, (async (
    result: ValidationResult,
    c: unknown,
  ) => {
    // A caller-supplied hook still runs first and still wins if it answers;
    // this only supplies the behaviour for the case nobody handled.
    if (hook) {
      const answered = await hook(result, c);
      if (answered) return answered;
    }
    if (!result.success) {
      throw new RequestValidationError({
        target,
        violations: issuesOf(result.error).map((issue) => violationOf(issue, result.data)),
      });
    }
    return undefined;
  }) as never);

  const guarded: MiddlewareHandler = async (c, next) => {
    // A failure raised before the route ran is the validator's; anything after
    // `next()` belongs to the handler and passes through untouched.
    let entered = false;
    try {
      return await validate(c, async () => {
        entered = true;
        await next();
      });
    } catch (error) {
      if (!entered && isMalformedBody(error)) {
        throw new MalformedRequestError({ target, detail: error.message });
      }
      throw error;
    }
  };

  // hono-openapi hangs the route's OpenAPI input schema off the middleware as
  // an own symbol property; the spec is built by reading it back, so it has to
  // survive the wrap.
  return Object.assign(guarded, validate);
}

interface ValidationResult {
  success: boolean;
  /** The raw candidate the schema rejected; both container versions supply it. */
  data?: unknown;
  /**
   * Two shapes, because hono-openapi changed containers at v1.
   *
   * v0.4 wrapped `@hono/zod-validator` and handed the hook zod's `ZodError`
   * itself, so the issues lived under `.issues`. v1 wraps
   * `@hono/standard-validator` and hands over the Standard Schema failure —
   * the issue array, bare.
   *
   * Both are accepted rather than only the current one: reading `.issues` off
   * an array yields `undefined`, and `undefined ?? []` is an empty violation
   * list, so getting this wrong does not throw. It ships a 422 that names no
   * field at all — the exact detail this whole seam exists to preserve.
   */
  error?: { issues?: ZodIssue[] } | readonly ZodIssue[];
}

/** The issues a validation failure carries, from either container shape. */
function issuesOf(error: ValidationResult["error"]): ZodIssue[] {
  if (!error) return [];
  return Array.isArray(error) ? [...error] : ((error as { issues?: ZodIssue[] }).issues ?? []);
}

/**
 * A drop-in for `hono-openapi`'s `validator`, declared AS its own type so
 * `c.req.valid("json")` stays typed. The cast is the price of borrowing a
 * type the package doesn't export.
 */
export const validator = build as unknown as typeof openApiValidator;

// ─────────────────────────────────────────────────────────────────────────────
// The wire-size cap every ingestion family carries.
// ─────────────────────────────────────────────────────────────────────────────

const BODY_LIMIT_ERROR_MESSAGE = "Payload Too Large";

export interface BodyLimitOptions {
  /** Maximum accepted body size, in bytes, as it arrives on the wire. */
  maxSize: number;
  /** Replaces the default 413 response. */
  onError?: MiddlewareHandler;
}

/**
 * Drains `body`, stopping the moment `maxSize` is passed so an oversized
 * upload is never fully buffered. Returns null once the cap is exceeded.
 */
export async function drainWithinCap(
  body: ReadableStream<Uint8Array>,
  maxSize: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxSize) return null;
    chunks.push(value);
  }

  const drained = new Uint8Array(new ArrayBuffer(size));
  let offset = 0;
  for (const chunk of chunks) {
    drained.set(chunk, offset);
    offset += chunk.length;
  }
  return drained;
}

/** RFC 9110: a `Content-Length` is a run of decimal digits and nothing else. */
const CONTENT_LENGTH = /^\d+$/;

/** The size the wire states authoritatively, or null when it states none. */
export function declaredSize(headers: Headers): number | null {
  if (headers.has("transfer-encoding")) return null;

  const header = headers.get("content-length");
  if (header === null || !CONTENT_LENGTH.test(header)) return null;

  // A length past the safe-integer range cannot be compared against the cap
  // meaningfully, so it drains and gets refused at the cap like any other body.
  const declared = Number(header);
  return Number.isSafeInteger(declared) ? declared : null;
}

/** The request a route reads after the body has been drained to measure it. */
function withBufferedBody(request: Request, body: Uint8Array<ArrayBuffer>): Request {
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
    signal: request.signal,
  });
}

/** Caps the size of a request body, rejecting anything larger with 413. */
export const bodyLimit = (options: BodyLimitOptions): MiddlewareHandler => {
  const { maxSize } = options;
  const onError =
    options.onError ??
    (() => {
      throw new HTTPException(413, {
        res: new Response(BODY_LIMIT_ERROR_MESSAGE, { status: 413 }),
      });
    });

  return async function bodyLimitMiddleware(c, next) {
    const request = c.req.raw;
    if (!request.body) return next();

    // A declared length is authoritative and free to read, so an oversized
    // body is rejected before a single byte arrives.
    const declared = declaredSize(request.headers);
    if (declared !== null) {
      return declared > maxSize ? onError(c, next) : next();
    }

    const body = await drainWithinCap(request.body, maxSize);
    if (!body) return onError(c, next);

    c.req.raw = withBufferedBody(request, body);

    return next();
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// The built-in tracer and request logger.
// ─────────────────────────────────────────────────────────────────────────────

const headersGetter = {
  keys: (carrier: Headers): string[] => Array.from(carrier.keys()),
  get: (carrier: Headers, key: string): string | string[] | undefined => carrier.get(key) ?? void 0,
};

function injectTraceHeaders(c: Context): void {
  const carrier: Record<string, string> = {};
  propagation.inject(otContext.active(), carrier);
  for (const [key, value] of Object.entries(carrier)) {
    try {
      c.res.headers.set(key, value);
    } catch {
      // ignore if response headers are not available
    }
  }
}

/** Creates a Hono middleware that wraps each request in an OTel span. */
export function tracerMiddleware(options?: { name?: string }) {
  return async (c: Context, next: Next): Promise<void> => {
    const tracer = trace.getTracer("langwatch:api:hono");

    const incomingHeaders = c.req.raw.headers;
    const parentCtx = propagation.extract(otContext.active(), incomingHeaders, headersGetter);

    const method = c.req.method;
    const spanName = `${method} ${options?.name ?? c.req.path}`;

    return otContext.with(parentCtx, async () => {
      return tracer.startActiveSpan(
        spanName,
        {
          kind: SpanKind.SERVER,
          attributes: options?.name ? { "service.name": options.name } : undefined,
        },
        async (span) => {
          let requestError: unknown;
          let isFinished = false;
          const finishSpan = () => {
            if (isFinished) return;
            isFinished = true;

            const organizationId = c.get("organization")?.id;
            const projectId = c.get("project")?.id;
            const userId = c.get("user")?.id;
            if (organizationId) {
              span.setAttribute("organization.id", organizationId);
            }
            if (projectId) {
              span.setAttribute("tenant.id", projectId);
            }
            if (userId) {
              span.setAttribute("user.id", userId);
            }

            const error = requestError ?? c.error;
            if (error) {
              span.recordException(error as Error);
              span.setStatus({ code: SpanStatusCode.ERROR });
            }
            span.end();
          };

          try {
            const spanCtx = span.spanContext();
            c.set("traceId", spanCtx.traceId);
            c.set("spanId", spanCtx.spanId);

            await next();
          } catch (err) {
            requestError = err;
            throw err;
          } finally {
            injectTraceHeaders(c);
            runAfterSSECompletion({
              c,
              onSettled: finishSpan,
              onStreamError: (error) => {
                requestError = error;
              },
            });
          }
        },
      );
    });
  };
}

/**
 * Creates a Hono middleware that logs each request using
 * `@langwatch/observability`.
 */
export function loggerMiddleware(options?: { name?: string }) {
  const logger = createLogger(`langwatch:api:${options?.name ?? "hono"}`);

  return async (c: Context, next: Next): Promise<void> => {
    if (c.get(REQUEST_LOG_CLAIM)) return next();
    c.set(REQUEST_LOG_CLAIM, true);

    const ctx = {
      organizationId: c.get("organization")?.id,
      projectId: c.get("project")?.id,
      userId: c.get("user")?.id,
    };

    return runWithContext(ctx, async () => {
      const start = nowInstant().epochMilliseconds;
      let error: unknown = c.error;

      try {
        await next();

        // Update context after auth resolves org/project/user
        updateCurrentContext({
          organizationId: c.get("organization")?.id,
          projectId: c.get("project")?.id,
          userId: c.get("user")?.id,
        });
      } catch (err) {
        error = err;
        throw err;
      } finally {
        const logRequest = () => {
          const duration = nowInstant().epochMilliseconds - start;
          // Prefer what the error handler resolved. Re-deriving the error and
          // its status here disagrees with the response whenever the handler
          // promoted the throw -- a ZodError has no `httpStatus`, so we derived
          // 500 for an error the caller received as a 422 ValidationError.
          const resolved = c.get(RESOLVED_ERROR) as ResolvedError | undefined;
          const requestError = resolved ? resolved.error : error || c.error;
          const statusCode =
            resolved?.status ??
            (requestError ? getStatusCodeFromError(requestError) : c.res.status);

          // The only error record written per failed request — the error handler deliberately
          // does not log its own copy. `route` is the matched endpoint (`GET /things/:id`), what
          // you group by when asking which endpoint is failing; absent for a 404 or version guard.
          const route = c.get(ENDPOINT_ROUTE) as string | undefined;
          // The family that resolved the route, which is not the family whose
          // logger claimed the record when several share a base path.
          const family = (c.get(REQUEST_FAMILY) as string | undefined) ?? options?.name;

          logHttpRequest(logger, {
            method: c.req.method,
            url: c.req.path,
            statusCode,
            duration,
            userAgent: c.req.header("user-agent") ?? null,
            error: requestError,
            extra: {
              ...(route ? { route } : {}),
              ...(family ? { family } : {}),
              ...(resolved?.traceId ? { traceId: resolved.traceId } : {}),
            },
          });
        };

        runAfterSSECompletion({
          c,
          onSettled: logRequest,
          onStreamError: (streamError) => {
            error = streamError;
          },
        });
      }
    });
  };
}

function runAfterSSECompletion({
  c,
  onSettled,
  onStreamError,
}: {
  c: Context;
  onSettled: () => void;
  onStreamError: (error: Error) => void;
}): void {
  const streamCompletion = getSSECompletion(c);
  if (!streamCompletion) {
    onSettled();
    return;
  }

  void streamCompletion
    .then(({ error }) => {
      try {
        if (error) onStreamError(error);
      } finally {
        onSettled();
      }
    })
    .catch(() => {
      // Instrumentation finalizers run after the response has started and must
      // never surface as an unhandled rejection in the application process.
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Declared middleware facts: what a route asks the process for beyond its own
// input, resolved once at the composition root.
// ─────────────────────────────────────────────────────────────────────────────

export interface RestTransportMiddleware<Schema extends z.ZodType = z.ZodType> {
  readonly name: string;
  readonly schema: Schema;
}

export interface RestTransportMiddlewareBinding {
  readonly middleware: RestTransportMiddleware;
  resolve(context: Context): unknown | Promise<unknown>;
}

export function defineRestMiddleware<Schema extends z.ZodType>(
  name: string,
  schema: Schema,
): RestTransportMiddleware<Schema> {
  return Object.freeze({ name, schema });
}

/** A composition root binds request access; handlers receive only the parsed result. */
export function bindRestMiddleware<Schema extends z.ZodType>(
  middleware: RestTransportMiddleware<Schema>,
  resolve: (context: Context) => z.input<Schema> | Promise<z.input<Schema>>,
): RestTransportMiddlewareBinding {
  return { middleware, resolve };
}

export function bindRestHeader<Schema extends z.ZodType>(
  middleware: RestTransportMiddleware<Schema>,
  header: string,
): RestTransportMiddlewareBinding {
  return { middleware, resolve: (context) => context.req.header(header) ?? null };
}

// ─────────────────────────────────────────────────────────────────────────────
// The typed SSE stream.
// ─────────────────────────────────────────────────────────────────────────────

export interface SSECompletion {
  error?: Error;
}

const completions = new WeakMap<Context, Promise<SSECompletion>>();

function createTypedStream<TEvents extends Record<string, ApiSchema>>({
  sseStream,
  events,
}: {
  sseStream: SSEStreamingApi;
  events: TEvents;
}): TypedSSEStream<TEvents> {
  return {
    async emit(event, data) {
      let value: unknown = data;
      const schema = events[event];
      if (schema) {
        const result = await parseApiSchema(schema, data);
        if (!result.success) {
          await sseStream.writeSSE({
            event: "error",
            data: JSON.stringify({
              message: `Validation failed for event "${String(event)}"`,
              issues: result.error.issues,
            }),
          });
          throw result.error;
        }
        value = result.data;
      }
      await sseStream.writeSSE({
        event: String(event),
        data: JSON.stringify(value),
      });
    },
    close() {
      sseStream.close();
    },
  };
}

/**
 * A typed wrapper around Hono's SSE streaming API.
 *
 * The `emit` method validates data against the declared event schema before
 * writing to the stream: a non-conforming payload writes an `error` event
 * carrying the issues and rejects, so the handler must catch to continue
 * streaming.
 */
export interface TypedSSEStream<TEvents extends Record<string, ApiSchema>> {
  /** Emit a typed event. Data is validated against the event's Zod schema. */
  emit<K extends string & keyof TEvents>(
    event: K,
    data: ApiSchemaOutput<TEvents[K]>,
  ): Promise<void>;
  /** Close the SSE stream. */
  close(): void;
}

/**
 * Handler function for SSE endpoints: `(c, stream)` — a stream has no body.
 * Request data arrives through a declared query schema and is read as the
 * typed context variable `c.get("query")`.
 */
export type SSEHandler<
  TVariables extends Record<string, unknown>,
  TEvents extends Record<string, ApiSchema>,
> = (c: ServiceContext<TVariables>, stream: TypedSSEStream<TEvents>) => void | Promise<void>;

/** Creates a Hono response that streams SSE events with typed validation. */
export function createSSEResponse<TEvents extends Record<string, ApiSchema>>({
  c,
  events,
  handler,
  onError,
}: {
  c: Context;
  events: TEvents;
  handler: (stream: TypedSSEStream<TEvents>) => void | Promise<void>;
  onError?: (error: Error) => void | Promise<void>;
}): Response {
  let finish!: (result: SSECompletion) => void;
  const completion = new Promise<SSECompletion>((resolve) => {
    finish = resolve;
  });
  completions.set(c, completion);

  return streamSSE(
    c,
    async (sseStream) => {
      sseStream.onAbort(() => finish({}));
      const typedStream = createTypedStream({ sseStream, events });

      try {
        await handler(typedStream);
        finish({});
      } catch (error) {
        throw error instanceof Error ? error : new Error("SSE handler failed", { cause: error });
      }
    },
    async (error) => {
      c.error = error;
      try {
        await onError?.(error);
      } finally {
        finish({ error });
      }
    },
  ) as unknown as Response;
}

/** Returns the current SSE handler lifecycle for request instrumentation. */
export function getSSECompletion(c: Context): Promise<SSECompletion> | undefined {
  return completions.get(c);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fan-out to every browser watching one tenant, as a REST family uses it.
//
// Delivery is Redis pub/sub with a local fallback, and which of the two is live
// depends on the process, so the transport takes the capability rather than the
// mechanism. The rate-limited call answers whether the event was published; a
// family that broadcasts a delta does not act on that, which is why the results
// are typed as `unknown` rather than pinned.
// ─────────────────────────────────────────────────────────────────────────────

export interface AppRestBroadcast {
  broadcastToTenant(
    tenantId: string,
    message: string,
    eventType: "simulation_updated" | "export_progress",
  ): Promise<unknown>;

  broadcastToTenantRateLimited(
    tenantId: string,
    message: string,
    eventType: "simulation_updated",
    tier: "structural" | "delta",
  ): Promise<unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// `Idempotency-Key`, the wire half. The ledger itself stays in the owning
// process and reaches a family as an injected port; this is what a family needs
// to DECLARE the behaviour without one.
// ─────────────────────────────────────────────────────────────────────────────

/** The header a caller sends to make a create replayable. */
export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

/** Set on a response that was served from a receipt rather than re-executed. */
export const IDEMPOTENT_REPLAY_HEADER = "X-Idempotent-Replay";

/** The key length bounds: floor guards against implausibly short reused keys. */
export const MIN_KEY_LENGTH = 8;
export const MAX_KEY_LENGTH = 255;

/**
 * A missing header writes no receipt. A present-but-unusable one is refused,
 * not ignored — a caller who sent one believes their retry is protected.
 */
export function readIdempotencyKey(raw: string | undefined | null): string | null {
  if (raw === undefined || raw === null) return null;

  const key = raw.trim();
  if (key.length < MIN_KEY_LENGTH || key.length > MAX_KEY_LENGTH) {
    throw new RequestValidationError({
      target: "header",
      violations: [
        {
          field: IDEMPOTENCY_KEY_HEADER,
          type: "invalid_length",
          message: `${IDEMPOTENCY_KEY_HEADER} must be between ${MIN_KEY_LENGTH} and ${MAX_KEY_LENGTH} characters.`,
          expected: `${MIN_KEY_LENGTH} to ${MAX_KEY_LENGTH} characters`,
          received: key.length,
        },
      ],
    });
  }

  return key;
}

/**
 * The whole `Response` travels back so the route answers with the exact
 * bytes the ledger stored, not a re-serialization.
 */
export interface IdempotentExecuted {
  isReplayed: false;
  status: number;
  response: Response;
}

/**
 * A string, not a parsed object, so a replay can't differ from the original
 * by so much as a key order.
 */
export interface IdempotentReplayed {
  isReplayed: true;
  status: number;
  serializedBody: string;
}

export type IdempotentOutcome = IdempotentExecuted | IdempotentReplayed;

/**
 * A family takes this as a port so it needs neither a database nor an
 * encryption key itself.
 */
export type IdempotentRunner = (input: {
  /**
   * Which create this is, e.g. `webhooks.v1.endpoints.create`. Folded into the
   * fingerprint so one key cannot answer for two different creates that share
   * a tenancy.
   */
  operation: string;
  /** The tenancy the key is unique within: a project id or an organization id. */
  scopeId: string;
  /** The key from {@link readIdempotencyKey}, or null for the unkeyed path. */
  key: string | null;
  /** The body as the route's validator produced it, not the raw bytes. */
  validatedBody: unknown;
  /**
   * Runs the create and writes its response. The ledger stores that response's
   * bytes as they are, which is what a replay hands back.
   */
  handler: () => Promise<Response>;
}) => Promise<IdempotentOutcome>;

/**
 * Spelled once so the docs can't drift from the same bounds the validator
 * enforces.
 */
export const idempotencyKeyParameter = {
  name: IDEMPOTENCY_KEY_HEADER,
  in: "header",
  required: false,
  description:
    `A caller-chosen key, ${MIN_KEY_LENGTH} to ${MAX_KEY_LENGTH} characters, that makes this create safe to retry. ` +
    "The first request to use a key runs normally and its response is stored for 24 hours. " +
    `A later request with the same key and the same body is not executed again: it returns the stored response, marked with \`${IDEMPOTENT_REPLAY_HEADER}: true\`. ` +
    "The same key with a different body is refused 409 `idempotency_error`, as is a retry sent while the original is still running. " +
    "Only successful responses are stored, so a create that failed can simply be retried with the same key.",
  schema: {
    type: "string",
    minLength: MIN_KEY_LENGTH,
    maxLength: MAX_KEY_LENGTH,
  },
} as const;

/** The marker a replayed response carries, for a success response's `headers`. */
export const idempotentReplayHeaders = {
  [IDEMPOTENT_REPLAY_HEADER]: {
    description:
      "Present and `true` only when this body came from a stored response rather than a fresh execution. Absent on the first use of a key, and on every request that carries no key.",
    // The values stay a mutable `string[]`: the OpenAPI header object this
    // is handed to types `enum` as a mutable array, and a readonly tuple
    // cannot be assigned to one.
    schema: { type: "string", enum: ["true"] as string[] },
  },
} as const;

/**
 * The replay header is the only thing telling a replay apart from the
 * original (status/body are identical by design). Absent, not `false`, on
 * a first execution — presence alone is the signal.
 */
export function idempotentJson({
  c,
  outcome,
}: {
  c: Context;
  outcome: IdempotentOutcome;
}): Response {
  // A first execution answers with the response it already wrote: those are
  // the bytes the receipt holds, so the replay below stands in for exactly
  // what the caller saw.
  if (!outcome.isReplayed) return outcome.response;

  c.header(IDEMPOTENT_REPLAY_HEADER, "true");
  // The stored bytes are written through rather than parsed and re-serialised,
  // so a replay cannot drift from the response it is standing in for.
  c.header("Content-Type", "application/json");
  if (outcome.serializedBody === "") return c.body(null, outcome.status as ContentfulStatusCode);
  return c.body(outcome.serializedBody, outcome.status as ContentfulStatusCode);
}

// ─────────────────────────────────────────────────────────────────────────────
// The receipt fingerprint: stable, key-order-independent JSON.
// ─────────────────────────────────────────────────────────────────────────────

function normalize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]),
    );
  }
  return value;
}

export function fingerprintJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// The receipt ledger behind `Idempotency-Key`. Called from inside the handler,
// not as middleware, so the fingerprint runs over the already-validated body. A
// pending row is filled in only on 2xx; a throw deletes it, since a failed
// create left nothing behind to double-create.
// ─────────────────────────────────────────────────────────────────────────────

/** How long a receipt answers for. */
export const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;

/** How often a request reports that the claim it holds is still running. */
export const HEARTBEAT_INTERVAL_MS = 5_000;

/**
 * Superseded by LIVENESS, not age: a slow request keeps beating and keeps
 * its claim. A takeover rewrites `claimId` rather than deleting the row, so
 * the replaced request's writes are fenced by a claim id it no longer holds.
 * Four missed beats, not one, so a GC pause isn't read as a death.
 */
export const TAKEOVER_AFTER_MS = 4 * HEARTBEAT_INTERVAL_MS;

/**
 * Bounded so a pathological race of insert-loss-then-clear cannot spin
 * forever.
 */
const CLAIM_ATTEMPTS = 3;

/** Why a key was refused. Echoed as `meta.reason` so a caller can branch. */
export type IdempotencyConflictReason = "body_mismatch" | "in_progress";

const CONFLICT_MESSAGES = {
  body_mismatch: "This Idempotency-Key was already used with a different request body.",
  in_progress:
    "The original request with this Idempotency-Key is still in progress; retry shortly.",
} as const satisfies Record<IdempotencyConflictReason, string>;

/**
 * A 409, not 400: the request is well-formed, so the caller's fix is a new
 * key or a wait, not a corrected field.
 */
export class IdempotencyConflictError extends HandledError {
  declare readonly code: "idempotency_error";

  constructor(reason: IdempotencyConflictReason) {
    super("idempotency_error", CONFLICT_MESSAGES[reason], {
      meta: { reason },
      httpStatus: 409,
      fault: "customer",
      retryable: reason === "in_progress",
    });
    this.name = "IdempotencyConflictError";
  }
}

/**
 * Key order independent. `operation` is included since the receipt is keyed
 * by tenancy alone — without it, two different creates with the same body
 * would replay each other's response.
 */
export function fingerprintRequestBody({
  operation,
  body,
}: {
  operation: string;
  body: unknown;
}): string {
  return sha256(fingerprintJson({ operation, body }));
}

export type IdempotencyReceiptCreateInput = {
  scopeId: string;
  key: string;
  claimId: string;
  requestFingerprint: string;
  heartbeatAt: Date;
  expiresAt: Date;
};

/**
 * Stated structurally, not imported from generated Prisma types — this
 * package is the API framework and may not depend on a schema.
 */
export type IdempotencyReceiptRecord = {
  id: string;
  claimId: string;
  requestFingerprint: string;
  heartbeatAt: Date;
  expiresAt: Date;
  responseStatus: number | null;
  responseBody: string | null;
};

export type IdempotencyReceiptUpdateInput = Partial<
  Pick<
    IdempotencyReceiptRecord,
    "claimId" | "heartbeatAt" | "expiresAt" | "responseStatus" | "responseBody"
  >
>;

/** Minimal durable receipt store used by the idempotency protocol. */
export interface IdempotencyReceiptPersistence {
  readonly idempotencyReceipt: {
    create(input: {
      data: IdempotencyReceiptCreateInput;
      select: { id: true };
    }): Promise<{ id: string }>;
    findUnique(input: {
      where: { scopeId_key: { scopeId: string; key: string } };
    }): Promise<IdempotencyReceiptRecord | null>;
    updateMany(input: {
      where: { id: string; claimId?: string; responseStatus?: null };
      data: IdempotencyReceiptUpdateInput;
    }): Promise<{ count: number }>;
    deleteMany(input: { where: { id: string; claimId?: string } }): Promise<{ count: number }>;
  };
}

/**
 * A port, since the key (`CREDENTIALS_SECRET`) belongs to the process and
 * this package reads no environment.
 */
export interface IdempotencyResponseCipher {
  encrypt(value: string): string;
  decrypt(value: string): string;
}

export interface WithIdempotencyParams {
  receipts: IdempotencyReceiptPersistence;
  /** The cipher the stored response body is written and read under. */
  cipher: IdempotencyResponseCipher;
  /**
   * Which create this is, e.g. `gateway.v1.virtual-keys.create`. Folded into
   * the fingerprint so one key cannot answer for two different creates that
   * share a tenancy.
   */
  operation: string;
  /** The tenancy the key is unique within: a project id or an organization id. */
  scopeId: string;
  /** The key from {@link readIdempotencyKey}, or null for the unkeyed path. */
  key: string | null;
  /** The body as the route's validator produced it, not the raw bytes. */
  validatedBody: unknown;
  /**
   * Runs the create and writes its response. What the receipt stores is that
   * response's own bytes, so a replay cannot re-derive them differently.
   */
  handler: () => Promise<Response>;
}

/**
 * Runs `handler` at most once per (scopeId, key), replaying its answer after.
 *
 * With no key it is a pass-through and touches no storage at all.
 */
export async function withIdempotency({
  receipts,
  cipher,
  operation,
  scopeId,
  key,
  validatedBody,
  handler,
}: WithIdempotencyParams): Promise<IdempotentOutcome> {
  if (key === null) {
    const response = await handler();
    return { isReplayed: false, status: response.status, response };
  }

  const requestFingerprint = fingerprintRequestBody({
    operation,
    body: validatedBody,
  });
  const claim = await claimReceipt({
    receipts,
    cipher,
    scopeId,
    key,
    requestFingerprint,
  });

  if (claim.kind === "replay") {
    return {
      isReplayed: true,
      status: claim.status,
      serializedBody: claim.serializedBody,
    };
  }

  const { receiptId, claimId } = claim;
  // Started before the handler and stopped in a finally, so the claim is
  // reported alive for exactly as long as this request is working on it.
  const heartbeat = startClaimHeartbeat({ receipts, receiptId, claimId });

  try {
    let response: Response;
    try {
      response = await handler();
    } catch (error) {
      await releaseClaim({ receipts, receiptId, claimId });
      throw error;
    }

    if (response.status >= 200 && response.status < 300) {
      await finalizeClaim({
        receipts,
        cipher,
        receiptId,
        claimId,
        status: response.status,
        // The bytes the caller is about to receive, read off the response
        // itself rather than re-serialised from the value behind it: an output
        // schema can order keys differently from the handler's object, and a
        // replay that re-derived the body would answer the same values in
        // different bytes.
        serializedBody: await readResponseBytes(response),
      });
    } else {
      await releaseClaim({ receipts, receiptId, claimId });
    }

    return { isReplayed: false, status: response.status, response };
  } finally {
    heartbeat.stop();
  }
}

/**
 * The response's body as bytes, without consuming the response the route is
 * about to return: the clone is what is read, the original is answered with.
 */
async function readResponseBytes(response: Response): Promise<string> {
  if (response.body === null) return "";
  return await response.clone().text();
}

/** A running claim's liveness reporting, for as long as its handler runs. */
interface ClaimHeartbeat {
  stop: () => void;
}

/**
 * On its own timer, not driven by the handler, since the handler can spend
 * minutes silent in one round trip. Unreferenced; a failed beat is logged,
 * not propagated — fencing catches the worst case.
 */
function startClaimHeartbeat({
  receipts,
  receiptId,
  claimId,
}: {
  receipts: IdempotencyReceiptPersistence;
  receiptId: string;
  claimId: string;
}): ClaimHeartbeat {
  const timer = setInterval(() => {
    receipts.idempotencyReceipt
      .updateMany({
        where: { id: receiptId, claimId },
        data: { heartbeatAt: toDate(nowInstant()) },
      })
      .then(({ count }) => {
        if (count > 0) return;
        // The claim is somebody else's now. Warn once and stop, rather than
        // writing nothing every interval for the rest of the handler.
        idempotencyLogger.warn(
          { receiptId, claimId },
          "Stopped reporting an idempotency claim this request no longer holds",
        );
        clearInterval(timer);
      })
      .catch((error) => {
        idempotencyLogger.warn(
          { receiptId, claimId, error },
          "Failed to report an idempotency claim as still running",
        );
      });
  }, HEARTBEAT_INTERVAL_MS);
  timer.unref();

  return { stop: () => clearInterval(timer) };
}

/**
 * The `claimId` predicate is the fence. Zero rows affected means this
 * request was declared dead and replaced mid-handler, so it logs loudly
 * rather than overwriting the new claim's row.
 */
async function finalizeClaim({
  receipts,
  cipher,
  receiptId,
  claimId,
  status,
  serializedBody,
}: {
  receipts: IdempotencyReceiptPersistence;
  cipher: IdempotencyResponseCipher;
  receiptId: string;
  claimId: string;
  status: number;
  serializedBody: string;
}): Promise<void> {
  const { count } = await receipts.idempotencyReceipt.updateMany({
    where: { id: receiptId, claimId },
    // Ciphertext; see `readStoredBody` for why.
    data: { responseStatus: status, responseBody: cipher.encrypt(serializedBody) },
  });

  if (count === 0) {
    idempotencyLogger.error(
      { receiptId, claimId, status },
      "An idempotency claim was taken over while its request was still running: the response was not stored and the key may now stand for a second resource",
    );
  }
}

/**
 * The bytes `c.json` writes for a body, for a caller that holds the value and
 * needs the receipt's stored form of it. The ledger itself no longer derives
 * the stored bytes this way: it reads them off the response the route wrote.
 */
export function serializeResponseBody(body: unknown): string {
  return JSON.stringify(body);
}

type Claim =
  | { kind: "claimed"; receiptId: string; claimId: string }
  | { kind: "replay"; status: number; serializedBody: string };

/**
 * `claimed` also comes from a takeover-in-place, not only a winning insert.
 * `retry` means the row wasn't authoritative.
 */
type ExistingVerdict = Claim | { kind: "retry" };

/**
 * Insert goes first: a read-then-write would let two concurrent retries
 * both find the key free.
 */
async function claimReceipt({
  receipts,
  cipher,
  scopeId,
  key,
  requestFingerprint,
}: {
  receipts: IdempotencyReceiptPersistence;
  cipher: IdempotencyResponseCipher;
  scopeId: string;
  key: string;
  requestFingerprint: string;
}): Promise<Claim> {
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
    const now = nowInstant();

    const claimed = await insertPendingReceipt({
      receipts,
      scopeId,
      key,
      requestFingerprint,
      now,
    });
    if (claimed !== null) return claimed;

    const existing = await receipts.idempotencyReceipt.findUnique({
      where: { scopeId_key: { scopeId, key } },
    });

    // Raced against a delete: the row went away between the insert losing and
    // this read, so the key is free again.
    if (!existing) continue;

    const verdict = await readExistingReceipt({
      receipts,
      cipher,
      existing,
      requestFingerprint,
      now,
    });
    if (verdict.kind !== "retry") return verdict;
  }

  // Every attempt lost its insert and then found the row gone. Something is
  // clearing rows underneath us; answer as contention rather than spinning.
  throw new IdempotencyConflictError("in_progress");
}

/** The claim on a fresh pending row, or null when the key was already taken. */
async function insertPendingReceipt({
  receipts,
  scopeId,
  key,
  requestFingerprint,
  now,
}: {
  receipts: IdempotencyReceiptPersistence;
  scopeId: string;
  key: string;
  requestFingerprint: string;
  now: Instant;
}): Promise<Extract<Claim, { kind: "claimed" }> | null> {
  const claimId = randomUUID();

  try {
    const created = await receipts.idempotencyReceipt.create({
      data: {
        scopeId,
        key,
        claimId,
        requestFingerprint,
        // The first beat is the insert itself, so the row is never momentarily
        // takeable in the interval before the timer's first tick.
        heartbeatAt: toDate(now),
        expiresAt: toDate(now.add({ milliseconds: RECEIPT_TTL_MS })),
      },
      select: { id: true },
    });
    return { kind: "claimed", receiptId: created.id, claimId };
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

/** Turns on the last heartbeat, never how long ago the claim was made. */
export function isClaimAbandoned({
  heartbeatAt,
  now,
}: {
  heartbeatAt: Instant;
  now: Instant;
}): boolean {
  return now.epochMilliseconds - heartbeatAt.epochMilliseconds > TAKEOVER_AFTER_MS;
}

/**
 * An update, not delete-and-insert, so the row keeps its identity. The
 * `claimId` predicate resolves two racing takeovers to one winner.
 */
async function takeOverClaim({
  receipts,
  existing,
  now,
}: {
  receipts: IdempotencyReceiptPersistence;
  existing: IdempotencyReceiptRecord;
  now: Instant;
}): Promise<ExistingVerdict> {
  const claimId = randomUUID();
  const { count } = await receipts.idempotencyReceipt.updateMany({
    where: { id: existing.id, claimId: existing.claimId, responseStatus: null },
    data: {
      claimId,
      heartbeatAt: toDate(now),
      expiresAt: toDate(now.add({ milliseconds: RECEIPT_TTL_MS })),
    },
  });

  if (count === 0) return { kind: "retry" };

  idempotencyLogger.warn(
    {
      receiptId: existing.id,
      displacedClaimId: existing.claimId,
      claimId,
      quietForMs: now.epochMilliseconds - existing.heartbeatAt.getTime(),
    },
    "Took over an idempotency claim that stopped reporting itself alive",
  );
  return { kind: "claimed", receiptId: existing.id, claimId };
}

/**
 * What the row already under this key says to do.
 *
 * `retry` means the row was not authoritative and has been cleared, so the
 * key is free for another attempt. Refusals throw.
 */
async function readExistingReceipt({
  receipts,
  cipher,
  existing,
  requestFingerprint,
  now,
}: {
  receipts: IdempotencyReceiptPersistence;
  cipher: IdempotencyResponseCipher;
  existing: IdempotencyReceiptRecord;
  requestFingerprint: string;
  now: Instant;
}): Promise<ExistingVerdict> {
  // Expiry is read before anything else, so a key past its lifetime is a
  // fresh key regardless of what the stale row happens to say.
  if (existing.expiresAt.getTime() <= now.epochMilliseconds) {
    await discardReceipt({ receipts, receiptId: existing.id });
    return { kind: "retry" };
  }

  // Ahead of the pending branch: a caller reusing one key for two different
  // bodies has made a mistake worth naming, whether or not the first request
  // has finished.
  if (existing.requestFingerprint !== requestFingerprint) {
    throw new IdempotencyConflictError("body_mismatch");
  }

  if (existing.responseStatus === null) {
    // Still reporting itself alive, however long ago it started. However slow
    // it is being, it is going to write its resource, and taking the key off
    // it is what would make one key stand for two.
    if (!isClaimAbandoned({ heartbeatAt: fromDate(existing.heartbeatAt), now })) {
      throw new IdempotencyConflictError("in_progress");
    }
    return await takeOverClaim({ receipts, existing, now });
  }

  const serializedBody = readStoredBody({ receipt: existing, cipher });
  // Nothing readable to replay, so the receipt cannot answer for the key. Same
  // handling as expiry: drop it and let the request through as a first use,
  // which is strictly better than refusing a create the caller can never make.
  if (serializedBody === null) {
    await discardReceipt({ receipts, receiptId: existing.id });
    return { kind: "retry" };
  }

  return {
    kind: "replay",
    status: existing.responseStatus,
    serializedBody,
  };
}

/**
 * Two of the four creates replay a secret shown only once (virtual key,
 * webhook signing secret), so the body is held as ciphertext under
 * {@link IdempotencyResponseCipher}. An unreadable row (secret rotated
 * mid-TTL) is dropped and treated as absent, not a failure.
 */
export function readStoredBody({
  receipt,
  cipher,
}: {
  receipt: IdempotencyReceiptRecord;
  cipher: IdempotencyResponseCipher;
}): string | null {
  if (receipt.responseBody === null) return null;

  try {
    return cipher.decrypt(receipt.responseBody);
  } catch (error) {
    idempotencyLogger.warn(
      { receiptId: receipt.id, error },
      "Dropping an unreadable idempotency receipt, likely CREDENTIALS_SECRET rotated since it was written",
    );
    return null;
  }
}

/**
 * Fenced on `claimId` like every other write a claim holder makes, so a
 * dead-and-replaced request can't delete the replacing request's row.
 */
async function releaseClaim({
  receipts,
  receiptId,
  claimId,
}: {
  receipts: IdempotencyReceiptPersistence;
  receiptId: string;
  claimId: string;
}): Promise<void> {
  try {
    const { count } = await receipts.idempotencyReceipt.deleteMany({
      where: { id: receiptId, claimId },
    });
    if (count === 0) {
      idempotencyLogger.warn(
        { receiptId, claimId },
        "An idempotency claim was taken over before its request could release it",
      );
    }
  } catch (error) {
    // Called on the failure path, where the caller is already propagating
    // something more informative. A receipt left pending expires on its own.
    idempotencyLogger.warn({ receiptId, error }, "Failed to release a pending idempotency receipt");
  }
}

/**
 * Unconditional, unlike {@link releaseClaim}: these rows (expired, or
 * undecryptable) have no request working under them.
 */
async function discardReceipt({
  receipts,
  receiptId,
}: {
  receipts: IdempotencyReceiptPersistence;
  receiptId: string;
}): Promise<void> {
  try {
    await receipts.idempotencyReceipt.deleteMany({ where: { id: receiptId } });
  } catch (error) {
    idempotencyLogger.warn({ receiptId, error }, "Failed to discard a spent idempotency receipt");
  }
}

/**
 * Duck-typed on the driver's own code, not `instanceof`: a bundler can
 * produce two copies of the error class, and a class check would then miss
 * a real violation.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "P2002"
  );
}

/**
 * ONE ledger per process: two ledgers over the same table would run two
 * takeover clocks against each other's claims. Satisfies {@link IdempotentRunner}.
 */
export class IdempotencyLedger {
  static create(options: {
    receipts: IdempotencyReceiptPersistence;
    cipher: IdempotencyResponseCipher;
  }): IdempotencyLedger {
    return new IdempotencyLedger(options.receipts, options.cipher);
  }

  private constructor(
    private readonly receipts: IdempotencyReceiptPersistence,
    private readonly cipher: IdempotencyResponseCipher,
  ) {}

  /**
   * The runner a keyed create dispatches through.
   *
   * A bound property rather than a method, so a composition can hand
   * `ledger.run` straight to a family's port without losing `this`.
   */
  readonly run: IdempotentRunner = (input) =>
    withIdempotency({
      receipts: this.receipts,
      cipher: this.cipher,
      operation: input.operation,
      scopeId: input.scopeId,
      key: input.key,
      validatedBody: input.validatedBody,
      handler: input.handler,
    });
}
