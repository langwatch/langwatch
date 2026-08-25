import { trace } from "@opentelemetry/api";
import type {
  HandledErrorFault,
  SerializedHandledError,
  SerializedReason,
} from "./serialized-handled-error";

/**
 * The Go pkg/herr wire envelope — herr and HandledError are the SAME model
 * (type ⇄ code, meta, trace ids, recursive reasons), so a typed error crosses
 * any Go→TS wire losslessly. herr guarantees the envelope only ever carries
 * known handled codes with vetted copy; genuinely unknown causes arrive
 * pre-collapsed to type "unknown".
 */
export interface HerrEnvelope {
  /**
   * The discriminant, OpenAI-compatible name. Go emits this and `code` with
   * the same value; `type` stays required here so an envelope from a writer
   * that only sets it still parses.
   */
  type: string;
  /** Always equal to `type` when Go wrote the envelope. Preferred when present. */
  code?: string;
  message: string;
  meta?: Record<string, unknown>;
  trace_id?: string;
  span_id?: string;
  fault?: HandledErrorFault;
  retryable?: boolean;
  tips?: string[];
  docs_url?: string;
  reasons?: HerrEnvelope[];
}

/**
 * Pluggable trace-URL source for {@link HandledError.serialize}. The package
 * is env-agnostic so it can be shared by the app, MCP server and CLI; the app
 * wires its Grafana link builder in via {@link setTraceUrlProvider} at module
 * load. Defaults to no trace URLs.
 */
export type TraceUrlProvider = (traceId: string | undefined) => string | undefined;

let traceUrlProvider: TraceUrlProvider = () => undefined;

export function setTraceUrlProvider(provider: TraceUrlProvider): void {
  traceUrlProvider = provider;
}

/**
 * TypeScript counterpart of Go's `herr.E`. Use the serialisable `code`, not
 * `instanceof`, across process boundaries. {@link HandledError.isHandled} also
 * survives duplicated bundle identities.
 *
 * Trace IDs come from the active OTel span unless supplied from a wire error.
 * Nested handled causes retain their code; unknown causes are masked. `fault`,
 * `tips`, and `docsUrl` are client-safe remediation metadata.
 */
export abstract class HandledError extends Error {
  readonly isHandled = true as const;
  readonly meta: Record<string, unknown>;
  readonly traceId: string | undefined;
  readonly spanId: string | undefined;
  readonly httpStatus: number;
  readonly fault: HandledErrorFault;
  readonly retryable: boolean;
  readonly tips: readonly string[];
  readonly docsUrl: string | undefined;
  readonly reasons: readonly Error[];

  constructor(
    public readonly code: string,
    message: string,
    options: {
      meta?: Record<string, unknown>;
      httpStatus?: number;
      fault?: HandledErrorFault;
      retryable?: boolean;
      tips?: readonly string[];
      docsUrl?: string;
      reasons?: readonly Error[];
      /**
       * Wire-provided trace/span ids (e.g. from a herr envelope). When set,
       * they win over the active span — a deserialized error keeps the ids of
       * the process that raised it, not whoever re-serializes it.
       */
      traceId?: string;
      spanId?: string;
    } = {},
  ) {
    super(message);
    const ctx = trace.getActiveSpan()?.spanContext();
    this.traceId = options.traceId ?? ctx?.traceId;
    this.spanId = options.spanId ?? ctx?.spanId;
    this.meta = options.meta ?? {};
    this.httpStatus = options.httpStatus ?? 500;
    this.fault = options.fault ?? "customer";
    this.retryable = options.retryable ?? false;
    this.tips = options.tips ?? [];
    this.docsUrl = options.docsUrl;
    this.reasons = options.reasons ?? [];
  }

  /** Produce the full user-facing serialised shape. */
  serialize(): SerializedHandledError {
    // traceId is the real trace id for handled errors, so it links straight to
    // the trace when a trace URL provider is wired (the app uses Grafana).
    const traceUrl = traceUrlProvider(this.traceId);
    return {
      code: this.code,
      // Deprecated back-compat alias — see SerializedHandledError.kind.
      kind: this.code,
      meta: this.meta,
      traceId: this.traceId,
      spanId: this.spanId,
      ...(traceUrl ? { traceUrl } : {}),
      httpStatus: this.httpStatus,
      fault: this.fault,
      retryable: this.retryable,
      ...(this.tips.length > 0 ? { tips: this.tips } : {}),
      ...(this.docsUrl ? { docsUrl: this.docsUrl } : {}),
      reasons: this.reasons.map(serializeReason),
    };
  }

  /**
   * Narrows `error` to the concrete subclass this is called on:
   *
   *   EvaluationNotFoundError.is(err)   // error is EvaluationNotFoundError
   *   NotFoundError.is(err)             // error is NotFoundError
   *
   * This is a plain `instanceof`, so it only holds within one module graph.
   * At a boundary, ask {@link HandledError.isHandled} instead ("is this
   * handled at all?"), or compare `err.code` to pick out one subclass.
   */
  static is<T extends HandledError>(
    this: abstract new (...args: never) => T,
    error: unknown,
  ): error is T {
    return error instanceof this;
  }

  /**
   * True when `error` is a handled error, including one whose class identity a
   * bundler duplicated — see {@link hasHandledErrorBrand}. Prefer this over
   * `instanceof HandledError` anywhere an error may have crossed a module
   * boundary (route handlers, tRPC middleware, error formatters).
   */
  static isHandled(error: unknown): error is HandledError {
    return error instanceof HandledError || hasHandledErrorBrand(error);
  }

  /** True when `error` is an unhandled infrastructure Error. */
  static isUnhandled(error: unknown): boolean {
    return error instanceof Error && !HandledError.isHandled(error);
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
  static toUserMessage(error: unknown, log?: (error: unknown) => void): string {
    if (HandledError.isHandled(error)) return error.message;
    log?.(error);
    return "An unknown error occurred";
  }
}

/**
 * Structural test for the `isHandled` brand.
 *
 * `instanceof` compares class identity, which breaks when a bundler includes
 * this module twice — Next.js/turbopack does this across route and server
 * boundaries, so an error can be a genuine HandledError raised from a *second*
 * copy of this class and still fail `instanceof`. Every instance carries the
 * `isHandled` brand as an own property, so matching on that recognises those
 * duplicates while still rejecting unrelated objects.
 *
 * The `instanceof Error` requirement is load-bearing, not belt-and-braces: the
 * brand is an own *enumerable* field, so `JSON.parse(JSON.stringify(err))` — or
 * a worker `postMessage` structured clone — produces a plain object that still
 * carries `isHandled: true` but has no prototype, and therefore none of the
 * methods this guard promises (`serialize`). Requiring a real `Error` rejects
 * those while still admitting bundler duplicates, since `Error` is the realm's
 * shared global. Wire payloads go through the boundary schema instead —
 * `handledErrorFromHerr` here, or `isHandledErrorLike` in `packages/api`.
 */
function hasHandledErrorBrand(error: unknown): error is HandledError {
  return error instanceof Error && (error as { isHandled?: unknown }).isHandled === true;
}

/**
 * Deserialize a herr wire envelope into a HandledError chain. A `tree_zebra`
 * herr from service A IS a `tree_zebra` HandledError here — same code, same
 * meta, same reasons; nothing marks it as having crossed a wire. Cross-process
 * identity is the `code` discriminant (see the class doc), exactly as if it
 * had been raised locally. Belongs in boundary middleware (wire schemas):
 * downstream code only ever receives the HandledError.
 */
export function handledErrorFromHerr(
  body: HerrEnvelope,
  options: { httpStatus?: number } = {},
): HandledError {
  // Go emits `code` and `type` with the same value; prefer `code` and fall back
  // to `type` so an envelope from an older writer resolves identically.
  const code = body.code ?? body.type;
  return new (class extends HandledError {
    constructor() {
      super(code, body.message, {
        meta: body.meta,
        httpStatus: options.httpStatus,
        fault: body.fault,
        retryable: body.retryable,
        tips: body.tips,
        docsUrl: body.docs_url,
        traceId: body.trace_id,
        spanId: body.span_id,
        reasons: (body.reasons ?? []).map((r) => handledErrorFromHerr(r)),
      });
      this.name = code;
    }
  })();
}

function serializeReason(error: Error): SerializedReason {
  if (HandledError.isHandled(error)) {
    // A HandledError's message is safe to show by the class contract, and for
    // a reason it is often the only prose there is (a herr-deserialized cause
    // carries its message on `.message`, not in meta — FromBody/toErrorBody
    // promote between the two on the Go side). Fold it into `meta.message` —
    // the ADR-045 prose channel consumers already read — so the reason chain
    // keeps naming the real failure across this serialization too. An explicit
    // meta.message wins; a message that merely repeats the code adds nothing.
    const meta =
      error.message && error.message !== error.code && !error.meta.message
        ? { ...error.meta, message: error.message }
        : error.meta;
    return {
      code: error.code,
      // Deprecated back-compat alias — see SerializedReason.kind.
      kind: error.code,
      fault: error.fault,
      retryable: error.retryable === true,
      ...(error.traceId ? { traceId: error.traceId } : {}),
      ...(error.spanId ? { spanId: error.spanId } : {}),
      ...(Object.keys(meta).length > 0 && { meta }),
      ...(error.tips.length > 0 && { tips: error.tips }),
      ...(error.docsUrl ? { docsUrl: error.docsUrl } : {}),
      ...(error.reasons.length > 0 && {
        reasons: error.reasons.map(serializeReason),
      }),
    };
  }
  return { code: "unknown", kind: "unknown", retryable: false };
}

/** Options shared by the convenience subclasses below. */
export interface HandledErrorOptions {
  meta?: Record<string, unknown>;
  fault?: HandledErrorFault;
  retryable?: boolean;
  tips?: readonly string[];
  docsUrl?: string;
  reasons?: readonly Error[];
}

/**
 * Thrown when a requested resource does not exist (HTTP 404).
 *
 * Domain-specific subclasses narrow `code` via `declare` and populate `meta`
 * with identifying fields (e.g. `{ spanId }`).
 */
export class NotFoundError extends HandledError {
  /**
   * `code` is a bare `string` on purpose, and that is NOT the same as saying
   * any string is acceptable.
   *
   * This package sits UPSTREAM of every tree that enumerates codes: the app
   * (`platform/app/src/features/errors/logic/codes.ts`), the MCP server and
   * `packages/api` all depend on it, and none of them can be
   * depended on from here without inverting that edge into a cycle. There is
   * also no single union to narrow to — each consumer owns its own code list,
   * and a union of one of them would reject the others' perfectly valid codes.
   *
   * So the enumeration is enforced downstream instead, where the codes live:
   * `platform/app/src/features/errors/logic/__tests__/codes.unit.test.ts` scans
   * the app's trees for every code a handled error declares — including the
   * `new NotFoundError("…", …)` shape specifically — and fails when a raised
   * code is missing from `APP_ERROR_CODES`, which is the key set the client
   * presentation registry must satisfy exhaustively. A code passed here
   * without copy fails that guard, not the type checker.
   */
  constructor(
    code: string,
    resource: string,
    id: string,
    options: HandledErrorOptions = {},
  ) {
    super(code, `${resource} not found: ${id}`, {
      ...options,
      meta: { id, ...options.meta },
      httpStatus: 404,
    });
    this.name = "NotFoundError";
  }
}

/** The part of a Zod 4 issue consumed at this portable boundary. */
export interface ZodLikeIssue {
  code: string;
  path: PropertyKey[];
  message: string;
}

/**
 * Structural stand-in for Zod's `ZodError`. Keeping this package independent
 * of the concrete schema runtime prevents a validation library from leaking
 * through the handled-error contract.
 */
export interface ZodLikeError {
  name: string;
  message: string;
  issues: ZodLikeIssue[];
  flatten(): {
    formErrors: string[];
    fieldErrors: Record<string, string[] | undefined>;
  };
}

/**
 * Is this a Zod error without coupling the boundary to one runtime instance?
 * `name`, `issues`, and `flatten` are the complete shape consumers read.
 */
export function isZodLikeError(err: unknown): err is ZodLikeError {
  if (typeof err !== "object" || err === null) return false;
  const candidate = err as Partial<ZodLikeError>;
  return (
    candidate.name === "ZodError" &&
    Array.isArray(candidate.issues) &&
    typeof candidate.flatten === "function"
  );
}

/**
 * Thrown when input fails domain-level validation rules (HTTP 422).
 */
export class ValidationError extends HandledError {
  constructor(message: string, options: HandledErrorOptions = {}) {
    super("validation_error", message, { httpStatus: 422, ...options });
    this.name = "ValidationError";
  }

  static fromZodError(zodError: ZodLikeError): ValidationError {
    const flat = zodError.flatten();
    return new ValidationError(zodError.message, {
      meta: {
        fieldErrors: flat.fieldErrors,
        formErrors: flat.formErrors,
      },
    });
  }
}
