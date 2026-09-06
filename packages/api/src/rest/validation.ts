/**
 * The Standard Schema validator doesn't throw on failure by default, so the
 * route's `onError` (ADR-045) never runs and the whole ZodError goes on the
 * wire, truncating the one actionable field. This wrapper installs the hook
 * and throws a typed error instead.
 */

import { HandledError, remediation } from "@langwatch/handled-error";
import type { MiddlewareHandler, ValidationTargets } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator as openApiValidator } from "hono-openapi";
import type { ZodIssue, ZodSchema } from "zod";

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
   * field at all — the exact detail this whole file exists to preserve.
   *
   * The elements are unchanged either way. Zod's Standard Schema issues ARE
   * `ZodIssue`s — `code`, `expected`, `options` and `path` all survive the
   * `~standard` boundary — so `violationOf` reads the same fields as before.
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
