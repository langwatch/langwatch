/**
 * Everything that happens to a REST request before its handler answers: the
 * validator that fails the way the boundary fails, the wire-size cap, the
 * tracer and request logger, the declared middleware facts, the typed SSE
 * stream, and the stable fingerprint a cached or replayed call is keyed by.
 */
import { createHash } from "node:crypto";

import { HandledError, remediation } from "@langwatch/handled-error";
import {
  createLogger,
  getStatusCodeFromError,
  logHttpRequest,
  type Logger,
  type RequestLogData,
} from "@langwatch/observability";
import { runWithContext, updateCurrentContext } from "@langwatch/observability/context";
import { nowInstant } from "@langwatch/time";
import {
  context as otContext,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import type { Context, MiddlewareHandler, Next, ValidationTargets } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { type SSEStreamingApi, streamSSE } from "hono/streaming";
import { validator as openApiValidator } from "hono-openapi";
import type { z, ZodIssue, ZodSchema } from "zod";

import { RESOLVED_ERROR, type ResolvedError } from "../errors.ts";
import type { ResponseCache } from "../ports.ts";
import { parseApiSchema, type ApiSchema, type ApiSchemaOutput } from "../schema.ts";
import {
  DECLARED_ANSWER,
  ENDPOINT_ROUTE,
  REQUEST_FAMILY,
  REQUEST_LOG_CLAIM,
  type Declined,
  type ServiceContext,
} from "./response.ts";

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
 * One refusal for a rejected request, whatever raised it - a bare zod error
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
    // off the raw input instead - scalars only, an object here is a shape
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
 * validator, BEFORE the schema function runs - so it cannot be caught by the
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
   * field at all - the exact detail this whole seam exists to preserve.
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
// The two capabilities a route declares and a process supplies the store for.
// The framework owns both keys - family, operation, version, principal - so a
// store never decides who is being limited or what an entry describes.
// ─────────────────────────────────────────────────────────────────────────────

/** What a rate-limited route declares: the bucket its calls are counted in. */
export type RestRateLimitPolicy = Readonly<{ bucket?: string }>;

/** What a cached route declares: how long an answer stands, and under what tag. */
export type RestCachePolicy = Readonly<{ ttlSeconds: number; tag: string }>;

/** One caller's calls of one operation of one version of one family. */
export function restRateLimitKey({
  family,
  operation,
  version,
  principal,
}: {
  family: string;
  operation: string;
  version: string;
  principal: string;
}): string {
  return `${family}:${operation}:${version}:${principal}`;
}

/** One complete call: the operation, the version, and the input it was given. */
export function restCacheKey({
  family,
  operation,
  version,
  input,
}: {
  family: string;
  operation: string;
  version: string;
  input: unknown;
}): string {
  return `${family}:${operation}:${version}:${fingerprintJson(input ?? null)}`;
}

/**
 * The answer a previous identical call left, if the store still holds it. A
 * store that fails answers nothing: a cache is an accelerator, and a caller
 * waiting on the handler is served either way.
 */
export async function cachedRestAnswer({
  cache,
  key,
  logger,
}: {
  cache: ResponseCache;
  key: string;
  logger: Logger;
}): Promise<Uint8Array | null> {
  try {
    return await cache.get(key);
  } catch (error) {
    logger.warn({ error }, "the response cache could not be read; running the handler");

    return null;
  }
}

/** The same store, written to. A failed write is a miss next time, and no more. */
export async function storeRestAnswer({
  cache,
  key,
  policy,
  body,
  logger,
}: {
  cache: ResponseCache;
  key: string;
  policy: RestCachePolicy;
  body: Uint8Array;
  logger: Logger;
}): Promise<void> {
  try {
    await cache.set(key, policy.tag, body, policy.ttlSeconds);
  } catch (error) {
    logger.warn({ error }, "the response cache could not be written");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bytes in and bytes out: the two declarations that take the framework's parser
// and serialiser off a route, for a body that IS the evidence and an answer
// that is not JSON.
// ─────────────────────────────────────────────────────────────────────────────

/** How a route that reads its own body wants the bytes it was sent. */
export type RestRawBodyForm = "text" | "bytes";

/**
 * A route whose body is the evidence - a signature is computed over the exact
 * characters a sender wrote, spacing included - so nothing parses it: the form
 * the handler reads it in, and the media type the document publishes for it.
 */
export type RestRawBody = Readonly<{ form: RestRawBodyForm; mediaType: string }>;

/** What the handler is handed for the form it asked for. */
export type RawBodyValue<Form extends RestRawBodyForm> = Form extends "text" ? string : Uint8Array;

/** The `Body` slot of a route that reads its own bytes. */
export type RestRawBodyDeclared<Form extends RestRawBodyForm = RestRawBodyForm> = Readonly<{
  rawBody: Form;
}>;

/** What a route that writes its own body publishes, and nothing of its shape. */
export type RestRawResponse = Readonly<{ produces: readonly string[] }>;

/** The body a raw answer carries; `null` for a 204, a 304, or a HEAD twin. */
export type RestRawBodyOut = ReadableStream | Uint8Array | string | null;

/** The answer of a route that writes its own bytes. */
export type RestRawAnswer = Readonly<{
  status?: ContentfulStatusCode;
  headers?: Readonly<Record<string, string>>;
  body: RestRawBodyOut;
}>;

/**
 * What a raw-answering handler returns: its own answer, a whole `Response` it
 * is forwarding, or - on an any-method route alone - a decline, which hands the
 * request to whatever is mounted after this family.
 */
export type RestRawResult = RestRawAnswer | Response | Declined;

/** The `Output` slot of a route that writes its own bytes: no schema at all. */
export type RestRawAnswerDeclared = Readonly<{ rawAnswer: "declared" }>;

// ─────────────────────────────────────────────────────────────────────────────
// The multipart body: the one request kind whose parts are not all text, so a
// declaration names the fields it parses and the file parts it takes delivery
// of, and the runtime hands the files over beside the parsed input.
// ─────────────────────────────────────────────────────────────────────────────

/** One file part a route names, and whether a request must carry it. */
export type RestMultipartFile = Readonly<{ required: boolean }>;

/** Every file part a route names, by the field name each arrives under. */
export type RestMultipartFiles = Readonly<Record<string, RestMultipartFile>>;

/** What a route that reads a multipart body declares: its fields, its files. */
export type RestMultipart = Readonly<{
  fields: z.ZodObject;
  files: RestMultipartFiles;
}>;

/** The `Body` slot of a route whose request carries files beside its fields. */
export type RestMultipartDeclared<
  Fields extends z.ZodObject = z.ZodObject,
  Files extends RestMultipartFiles = RestMultipartFiles,
> = Readonly<{ multipartFields: Fields; multipartFiles: Files }>;

/**
 * Reads one multipart body: the declared file parts are taken as files, and
 * everything else is parsed by the schema the route named for its fields.
 * Both halves are refused the way every other source is.
 */
export function multipartMiddleware({
  multipart,
  fieldsKey,
  filesKey,
}: {
  multipart: RestMultipart;
  fieldsKey: string;
  filesKey: string;
}): MiddlewareHandler {
  return async (context, next) => {
    const form = await context.req.parseBody({ all: false });
    const files: Record<string, File> = {};
    const violations: FieldViolation[] = [];

    for (const [name, part] of Object.entries(multipart.files)) {
      const value = form[name];

      if (value instanceof File) files[name] = value;
      else if (value !== undefined) violations.push(notAFile(name));
      else if (part.required) violations.push(missingFile(name));
    }

    if (violations.length > 0) throw new RequestValidationError({ target: "form", violations });

    const declared = Object.entries(form).filter(([name]) => !(name in multipart.files));
    const fields = Object.fromEntries(declared);
    const parsed = multipart.fields.safeParse(fields);

    if (!parsed.success) {
      throw requestValidationErrorFrom({ target: "form", error: parsed.error, input: fields });
    }

    context.set(fieldsKey, parsed.data);
    context.set(filesKey, files);
    await next();
  };
}

function missingFile(field: string): FieldViolation {
  return { field, type: "missing_file", message: `The file part "${field}" is required.` };
}

function notAFile(field: string): FieldViolation {
  return { field, type: "invalid_file", message: `The part "${field}" must be an uploaded file.` };
}

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

          // The only error record written per failed request - the error handler deliberately
          // does not log its own copy. `route` is the matched endpoint (`GET /things/:id`), what
          // you group by when asking which endpoint is failing; absent for a 404 or version guard.
          const route = c.get(ENDPOINT_ROUTE) as string | undefined;
          // The family that resolved the route, which is not the family whose
          // logger claimed the record when several share a base path.
          const family = (c.get(REQUEST_FAMILY) as string | undefined) ?? options?.name;

          const record: RequestLogData = {
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
          };

          // A status the route DECLARED is an answer, not a fault.
          if (!requestError && c.get(DECLARED_ANSWER) === true) {
            logDeclaredAnswer(logger, record);
            return;
          }

          logHttpRequest(logger, record);
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

/**
 * The record for an answer the route DECLARED. `logHttpRequest` reads the level
 * off the status alone, which would file an unhealthy platform report as an
 * uncaused 5xx; the fields are the ones it writes, and nothing carries a cause
 * because there is none.
 */
function logDeclaredAnswer(logger: Logger, data: RequestLogData): void {
  const { extra, error: _cause, ...request } = data;

  logger.info({ ...extra, ...request }, "request handled");
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
 * Handler function for SSE endpoints: `(c, stream)` - a stream has no body.
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
