import { trace } from "@opentelemetry/api";
import type { ZodError } from "zod";

export interface DomainErrorTelemetry {
  traceId: string | undefined;
  spanId: string | undefined;
}

export interface SerializedReason {
  kind: string;
  meta?: Record<string, unknown>;
  reasons?: SerializedReason[];
}

export interface SerializedDomainError {
  kind: string;
  meta: Record<string, unknown>;
  telemetry: DomainErrorTelemetry;
  httpStatus: number;
  reasons: SerializedReason[];
}

/**
 * Base class for all handled domain errors.
 *
 * `kind` is a serialisable string discriminant — safe across process/worker
 * boundaries and serialisation (use instead of `instanceof` in those cases):
 *
 * ```ts
 * if (err.kind === "evaluation_not_found") { ... }   // cross-process safe
 * if (err instanceof EvaluationNotFoundError) { ...} // same-process only
 * ```
 *
 * `meta` carries domain-specific context (e.g. `{ spanId }`) included in the
 * serialised shape. `httpStatus` is the suggested HTTP response code (defaults
 * to 500; subclasses set appropriate defaults). `traceId` / `spanId` are
 * captured automatically from the active OTel span. `reasons` serialises
 * DomainErrors by kind and masks everything else as `{ kind: "unknown" }`.
 *
 * Serialised shape:
 * ```json
 * {
 *   "kind": "span_not_found",
 *   "meta": { "spanId": "abc" },
 *   "telemetry": { "traceId": "...", "spanId": "..." },
 *   "httpStatus": 404,
 *   "reasons": [{ "kind": "invalid_span_id" }, { "kind": "unknown" }]
 * }
 * ```
 */
export abstract class DomainError extends Error {
  readonly isHandled = true as const;
  readonly meta: Record<string, unknown>;
  readonly telemetry: DomainErrorTelemetry;
  readonly httpStatus: number;
  readonly reasons: readonly Error[];

  constructor(
    public readonly kind: string,
    message: string,
    options: {
      meta?: Record<string, unknown>;
      httpStatus?: number;
      reasons?: readonly Error[];
    } = {},
  ) {
    super(message);
    const ctx = trace.getActiveSpan()?.spanContext();
    this.telemetry = { traceId: ctx?.traceId, spanId: ctx?.spanId };
    this.meta = options.meta ?? {};
    this.httpStatus = options.httpStatus ?? 500;
    this.reasons = options.reasons ?? [];
  }

  /** Produce the full user-facing serialised shape. */
  serialize(): SerializedDomainError {
    return {
      kind: this.kind,
      meta: this.meta,
      telemetry: this.telemetry,
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
   *   DomainError.is(err)               // error is DomainError
   */
  static is<T extends DomainError>(
    this: abstract new (...args: never) => T,
    error: unknown,
  ): error is T {
    return error instanceof this;
  }

  /** Returns true when `error` is a known, handled DomainError. */
  static isHandled(error: unknown): error is DomainError {
    return error instanceof DomainError;
  }

  /** Returns true when `error` is an unhandled infrastructure Error. */
  static isUnhandled(error: unknown): boolean {
    return error instanceof Error && !(error instanceof DomainError);
  }

  /**
   * Returns a safe user-facing message for any error:
   * - DomainErrors → their own message (safe to show users)
   * - Everything else → a generic "unknown error" string, and the original
   *   error is passed to the optional `log` callback for server-side logging.
   *
   * ```ts
   * } catch (e) {
   *   const msg = DomainError.toUserMessage(e, (err) => logger.error(err));
   *   throw new TRPCError({ code: "NOT_FOUND", message: msg });
   * }
   * ```
   */
  static toUserMessage(
    error: unknown,
    log?: (error: unknown) => void,
  ): string {
    if (error instanceof DomainError) return error.message;
    log?.(error);
    return "An unknown error occurred";
  }
}

function serializeReason(error: Error): SerializedReason {
  if (error instanceof DomainError) {
    return {
      kind: error.kind,
      ...(Object.keys(error.meta).length > 0 && { meta: error.meta }),
      ...(error.reasons.length > 0 && {
        reasons: error.reasons.map(serializeReason),
      }),
    };
  }
  return { kind: "unknown" };
}


/**
 * Thrown when a requested resource does not exist (HTTP 404).
 *
 * Domain-specific subclasses narrow `kind` via `declare` and populate `meta`
 * with identifying fields (e.g. `{ spanId }`).
 */
export class NotFoundError extends DomainError {
  constructor(
    kind: string,
    resource: string,
    id: string,
    options: { meta?: Record<string, unknown>; reasons?: readonly Error[] } = {},
  ) {
    super(kind, `${resource} not found: ${id}`, {
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
export class ValidationError extends DomainError {
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
