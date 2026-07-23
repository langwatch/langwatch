/**
 * The REST boundary's request validator.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * `@hono/zod-validator` does not THROW when a request fails its schema — it
 * *returns* `c.json(result, 400)`, where `result` is zod's `safeParse` output
 * serialised whole. Two things follow, and both are bad:
 *
 *   1. The route's `onError` never runs, so `handleError` never sees it. Every
 *      other failure at this boundary is a `HandledError` with a code, a status
 *      and a remediation channel (ADR-045); a schema failure was the one hole,
 *      answering in a shape no consumer knows how to read. The CLI's reader
 *      finds no `error`/`code`/`kind` in that body, falls through to the
 *      status-derived reading, and reports `request_failed` — or, when the
 *      status is lost on the way, `network_error`. An agent told "network_error"
 *      retries the identical broken request forever.
 *
 *   2. The whole ZodError goes on the wire. A single wrong enum value produces
 *      a paragraph listing every permitted value inline, which then gets
 *      truncated on its way to the model — losing the only part worth having.
 *
 * So this wrapper installs the hook zod-validator always accepted and nobody
 * passed: on failure it THROWS a typed error, and the ordinary boundary
 * machinery takes it from there.
 *
 * ── THE SHAPE ──────────────────────────────────────────────────────────────
 *
 * A short sentence, and the detail as structured `reasons` — one per zod issue,
 * modelled on Go's `cher.E`, which the platform's `HandledError` already
 * mirrors field-for-field:
 *
 *     HTTP 422
 *     { "error": "validation_error",
 *       "message": "The request body didn't match the expected shape.",
 *       "target": "json",
 *       "fields": ["series.0.metric"],
 *       "reasons": [
 *         { "code": "schema_failure",
 *           "meta": { "field": "series.0.metric",
 *                     "type": "invalid_enum_value",
 *                     "message": "Invalid enum value",
 *                     "expected": ["metadata.trace_id", "metadata.user_id"] } }
 *       ] }
 *
 * `meta.field` is the thing a caller can act on, and it survives truncation in
 * a way a prose paragraph does not.
 *
 * ── WHY 422, AND WHY THE OTHER ONE IS 400 ──────────────────────────────────
 *
 * The two failures are not the same failure and must not share a status:
 *
 *   - The request PARSED and the schema rejected it → 422 Unprocessable
 *     Content. The syntax was fine; the semantics were not. A caller can fix
 *     exactly the fields named in `reasons` and retry.
 *   - The request did not parse at all (malformed JSON, broken form body) →
 *     400 Bad Request. There are no fields to name because there is no
 *     document. Hono's own validator already raises this as an `HTTPException`
 *     before any schema runs; we only give it a code so it stops arriving
 *     anonymous.
 *
 * Both are the caller's fault (`fault: "customer"`) and neither is retryable
 * unchanged.
 */

import { HandledError } from "@langwatch/handled-error";
import type { MiddlewareHandler, ValidationTargets } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator as openApiValidator } from "hono-openapi/zod";
import type { ZodIssue, ZodSchema } from "zod";

import { remediation } from "~/server/app-layer/error-remediation";

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
 * One thing wrong with one part of the request.
 *
 * Deliberately not zod's own `ZodIssue`: schema failures are the common source
 * but not the only one. A route that validates a field against something a
 * schema cannot know — that a select path names a real column, that an id
 * belongs to this project — is reporting the same KIND of fact, and a caller
 * should not have to read two shapes to learn it.
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
 * One violation, as a link in the `reasons` chain.
 *
 * A reason is a HandledError like any other, so `serialize()` renders it with
 * the same `code`/`meta`/nested-`reasons` shape as the error it hangs off —
 * there is no second serialisation path to keep in step.
 */
class SchemaFailure extends HandledError {
  constructor(violation: FieldViolation) {
    super("schema_failure", violation.message, {
      httpStatus: 422,
      meta: {
        field: violation.field,
        type: violation.type,
        message: violation.message,
        ...(violation.expected !== undefined
          ? { expected: violation.expected }
          : {}),
        ...(violation.received !== undefined
          ? { received: violation.received }
          : {}),
      },
    });
    this.name = "SchemaFailure";
  }
}

/**
 * The request parsed, and validation said no.
 *
 * Exported so a route can raise it for a check its schema could not express —
 * the alternative being an anonymous `HTTPException(400)`, which is what this
 * whole module exists to stop shipping.
 */
export class RequestValidationError extends HandledError {
  constructor(args: {
    target: keyof ValidationTargets;
    violations: readonly FieldViolation[];
  }) {
    super(
      "validation_error",
      `The ${TARGET_NOUN[args.target]} didn't match the expected shape.`,
      {
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
      },
    );
    this.name = "RequestValidationError";
  }
}

/** A zod issue, read into the shape above. */
function violationOf(issue: ZodIssue): FieldViolation {
  return {
    field: fieldOf(issue),
    type: issue.code,
    message: issue.message,
    ...expectationOf(issue),
  };
}

/** The request never parsed, so no schema ever ran. */
class MalformedRequestError extends HandledError {
  constructor(args: { target: keyof ValidationTargets; detail: string }) {
    super(
      "malformed_request",
      `The ${TARGET_NOUN[args.target]} could not be parsed.`,
      {
        httpStatus: 400,
        fault: "customer",
        meta: { target: args.target, detail: args.detail },
        ...remediation("malformed_request"),
      },
    );
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
 * What the schema wanted, when the issue knows.
 *
 * This is the part the prose form kept losing: an enum's permitted values are
 * the single most actionable fact in a validation failure, and inlining them in
 * a sentence is exactly what made that sentence long enough to be truncated.
 * As structured data they cost nothing to carry and can be listed by a UI.
 */
function expectationOf(issue: ZodIssue): Record<string, unknown> {
  if (issue.code === "invalid_enum_value") {
    return { expected: issue.options, received: issue.received };
  }
  if (issue.code === "invalid_type") {
    return { expected: issue.expected, received: issue.received };
  }
  if (issue.code === UNRECOGNIZED_KEYS) {
    return { unrecognized: issue.keys };
  }
  // A refinement is zod's escape hatch, so its issues know nothing about what
  // the schema wanted — but the schema often does (a catalog lookup no plain
  // enum can express). A `superRefine` that adds its issue with
  // `params: { expected, received }` gets the same structured channel enum
  // failures get for free, so a caller reads ONE shape whichever kind of
  // schema rejected the field.
  if (issue.code === "custom" && issue.params) {
    const params = issue.params as Record<string, unknown>;
    return {
      ...(params.expected !== undefined ? { expected: params.expected } : {}),
      ...(params.received !== undefined ? { received: params.received } : {}),
    };
  }
  return {};
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
  const validate = openApiValidator(
    target,
    schema,
    (async (result: ValidationResult, c: unknown) => {
      // A caller-supplied hook still runs first and still wins if it answers;
      // this only supplies the behaviour for the case nobody handled.
      if (hook) {
        const answered = await hook(result, c);
        if (answered) return answered;
      }
      if (!result.success) {
        throw new RequestValidationError({
          target,
          violations: (result.error?.issues ?? []).map(violationOf),
        });
      }
      return undefined;
    }) as never,
  );

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
  error?: { issues: ZodIssue[] };
}

/**
 * A request validator that fails the way the rest of the boundary fails.
 *
 * A drop-in for `hono-openapi/zod`'s `validator`: it takes the same arguments,
 * carries the OpenAPI metadata the spec generator reads, and — because it is
 * declared AS that function's own type — preserves its inference exactly, so
 * `c.req.valid("json")` stays typed at every call site. Restating that
 * signature by hand would mean copying hono-openapi's internal `HasUndefined`
 * conditional, which the package does not export; borrowing the type is both
 * shorter and incapable of drifting from it.
 *
 * The single cast is the price of that borrowing: the implementation is written
 * against the loose runtime contract, and the exported binding declares the
 * precise one.
 */
export const validator = build as unknown as typeof openApiValidator;
