import { trace } from "@opentelemetry/api";
import type { ZodError } from "zod";

import { grafanaTraceUrlFromEnv } from "~/utils/grafanaLinks";

export interface SerializedReason {
  code: string;
  /**
   * @deprecated Back-compat alias of `code`, emitted during the
   * `DomainError` → `HandledError` transition so clients still reading the old
   * `kind` discriminant keep working. Read `code` in new code; this alias is
   * removed once no consumer reads `kind`.
   */
  kind: string;
  meta?: Record<string, unknown>;
  reasons?: SerializedReason[];
}

/**
 * Serialised, client-safe shape of a {@link HandledError}. Mirrors the Go
 * `herr.E` (`pkg/herr`): `code`/`meta`/`traceId`/`spanId`/`reasons` line up
 * field-for-field with `Code`/`Meta`/`TraceID`/`SpanID`/`Reasons`. `httpStatus`
 * and `traceUrl` are TypeScript-side conveniences with no `herr.E` equivalent
 * (Go maps code→status via a registry and builds the trace link elsewhere).
 */
export interface SerializedHandledError {
  code: string;
  /**
   * @deprecated Back-compat alias of `code`, emitted during the
   * `DomainError` → `HandledError` transition so clients still reading the old
   * `kind` discriminant keep working. Read `code` in new code; this alias is
   * removed once no consumer reads `kind`.
   */
  kind: string;
  meta: Record<string, unknown>;
  traceId: string | undefined;
  spanId: string | undefined;
  /**
   * A clickable Grafana link straight to this trace, present whenever a Grafana
   * is configured (GRAFANA_BASE_URL — set automatically by haven locally).
   * Included in production too: Grafana is access-controlled, so the URL leaks
   * nothing to a client that can't reach it.
   */
  traceUrl?: string;
  httpStatus: number;
  reasons: SerializedReason[];
}

/**
 * The Go pkg/herr wire envelope — herr and HandledError are the SAME model
 * (type ⇄ code, meta, trace ids, recursive reasons), so a typed error crosses
 * any Go→TS wire losslessly. herr guarantees the envelope only ever carries
 * known handled codes with vetted copy; genuinely unknown causes arrive
 * pre-collapsed to type "unknown".
 */
export interface HerrEnvelope {
  type: string;
  message: string;
  meta?: Record<string, unknown>;
  trace_id?: string;
  span_id?: string;
  reasons?: HerrEnvelope[];
}

/**
 * Base class for all handled errors — the TypeScript counterpart of Go's
 * `herr.E` (`pkg/herr`). Its shape matches `herr.E` field-for-field:
 * `code`↔`Code`, `meta`↔`Meta`, `traceId`↔`TraceID`, `spanId`↔`SpanID`,
 * `reasons`↔`Reasons`. (`httpStatus` is TS-only; Go maps code→status via a
 * registry. Stack traces stay on the native `Error.stack` and never serialise.)
 *
 * `code` is a serialisable string discriminant — safe across process/worker
 * boundaries and serialisation (use instead of `instanceof` in those cases):
 *
 * ```ts
 * if (err.code === "evaluation_not_found") { ... }   // cross-process safe
 * if (err instanceof EvaluationNotFoundError) { ...}  // same-process only
 * ```
 *
 * `meta` carries domain-specific context (e.g. `{ spanId }`) included in the
 * serialised shape. `httpStatus` is the suggested HTTP response code (defaults
 * to 500; subclasses set appropriate defaults). `traceId` / `spanId` are
 * captured automatically from the active OTel span. `reasons` serialises nested
 * HandledErrors by code and masks everything else as `{ code: "unknown" }`.
 *
 * Serialised shape:
 * ```json
 * {
 *   "code": "span_not_found",
 *   "meta": { "spanId": "abc" },
 *   "traceId": "...",
 *   "spanId": "...",
 *   "httpStatus": 404,
 *   "reasons": [{ "code": "invalid_span_id" }, { "code": "unknown" }]
 * }
 * ```
 */
export abstract class HandledError extends Error {
  readonly isHandled = true as const;
  readonly meta: Record<string, unknown>;
  readonly traceId: string | undefined;
  readonly spanId: string | undefined;
  readonly httpStatus: number;
  readonly reasons: readonly Error[];

  constructor(
    public readonly code: string,
    message: string,
    options: {
      meta?: Record<string, unknown>;
      httpStatus?: number;
      reasons?: readonly Error[];
    } = {},
  ) {
    super(message);
    const ctx = trace.getActiveSpan()?.spanContext();
    this.traceId = ctx?.traceId;
    this.spanId = ctx?.spanId;
    this.meta = options.meta ?? {};
    this.httpStatus = options.httpStatus ?? 500;
    this.reasons = options.reasons ?? [];
  }

  /** Produce the full user-facing serialised shape. */
  serialize(): SerializedHandledError {
    // traceId is the real trace id for handled errors, so it links straight to
    // the trace when a Grafana is configured — see grafanaTraceUrlFromEnv.
    const traceUrl = grafanaTraceUrlFromEnv(this.traceId);
    return {
      code: this.code,
      // Deprecated back-compat alias — see SerializedHandledError.kind.
      kind: this.code,
      meta: this.meta,
      traceId: this.traceId,
      spanId: this.spanId,
      ...(traceUrl ? { traceUrl } : {}),
      httpStatus: this.httpStatus,
      reasons: this.reasons.map(serializeReason),
    };
  }

  /**
   * Type-safe guard: narrows `error` to the concrete subclass.
   *
   * Usage:
   *   EvaluationNotFoundError.is(err)   // error is EvaluationNotFoundError
   *   NotFoundError.is(err)             // error is NotFoundError
   *   HandledError.is(err)              // error is HandledError
   */
  static is<T extends HandledError>(
    this: abstract new (...args: never) => T,
    error: unknown,
  ): error is T {
    return error instanceof this;
  }

  /** Returns true when `error` is a known, handled HandledError. */
  static isHandled(error: unknown): error is HandledError {
    return error instanceof HandledError;
  }

  /** Returns true when `error` is an unhandled infrastructure Error. */
  static isUnhandled(error: unknown): boolean {
    return error instanceof Error && !(error instanceof HandledError);
  }

  /**
   * Returns a safe user-facing message for any error:
   * - HandledErrors → their own message (safe to show users)
   * - Everything else → a generic "unknown error" string, and the original
   *   error is passed to the optional `log` callback for server-side logging.
   *
   * ```ts
   * } catch (e) {
   *   const msg = HandledError.toUserMessage(e, (err) => logger.error(err));
   *   throw new TRPCError({ code: "NOT_FOUND", message: msg });
   * }
   * ```
   */
  static toUserMessage(
    error: unknown,
    log?: (error: unknown) => void,
  ): string {
    if (error instanceof HandledError) return error.message;
    log?.(error);
    return "An unknown error occurred";
  }
}

/**
 * Deserialize a herr wire envelope into a HandledError chain. A `tree_zebra`
 * herr from service A IS a `tree_zebra` HandledError here — same code, same
 * meta, same reasons; nothing marks it as having crossed a wire. Cross-process
 * identity is the `code` discriminant (see the class doc), exactly as if it
 * had been raised locally. Belongs in boundary middleware (wire schemas):
 * downstream code only ever receives the HandledError.
 */
export function handledErrorFromHerr(body: HerrEnvelope): HandledError {
  return new (class extends HandledError {
    constructor() {
      super(body.type, body.message, {
        meta: {
          ...body.meta,
          ...(body.trace_id ? { traceId: body.trace_id } : {}),
        },
        reasons: (body.reasons ?? []).map(handledErrorFromHerr),
      });
      this.name = body.type;
    }
  })();
}

function serializeReason(error: Error): SerializedReason {
  if (error instanceof HandledError) {
    return {
      code: error.code,
      // Deprecated back-compat alias — see SerializedReason.kind.
      kind: error.code,
      ...(Object.keys(error.meta).length > 0 && { meta: error.meta }),
      ...(error.reasons.length > 0 && {
        reasons: error.reasons.map(serializeReason),
      }),
    };
  }
  return { code: "unknown", kind: "unknown" };
}


/**
 * Thrown when a requested resource does not exist (HTTP 404).
 *
 * Domain-specific subclasses narrow `code` via `declare` and populate `meta`
 * with identifying fields (e.g. `{ spanId }`).
 */
export class NotFoundError extends HandledError {
  constructor(
    code: string,
    resource: string,
    id: string,
    options: { meta?: Record<string, unknown>; reasons?: readonly Error[] } = {},
  ) {
    super(code, `${resource} not found: ${id}`, {
      meta: { id, ...options.meta },
      httpStatus: 404,
      reasons: options.reasons,
    });
    this.name = "NotFoundError";
  }
}

/**
 * Thrown when input fails domain-level validation rules (HTTP 422).
 */
export class ValidationError extends HandledError {
  constructor(
    message: string,
    options: { meta?: Record<string, unknown>; reasons?: readonly Error[] } = {},
  ) {
    super("validation_error", message, { httpStatus: 422, ...options });
    this.name = "ValidationError";
  }

  static fromZodError(zodError: ZodError): ValidationError {
    const flat = zodError.flatten();
    return new ValidationError(zodError.message, {
      meta: {
        fieldErrors: flat.fieldErrors,
        formErrors: flat.formErrors,
      },
    });
  }
}
