import { trace } from "@opentelemetry/api";

/**
 * Who is responsible for a handled error — the axis that drives log level and
 * alerting (handled-ness itself only decides what the *client* sees):
 *
 * - `customer`: the caller can fix it (bad filter, not found, permission).
 *   Expected; logged at warn, watched for spikes.
 * - `platform`: our infrastructure failed (ClickHouse down, worker spawn).
 *   Logged at error — an incident, not noise.
 * - `provider`: a third party failed (LLM provider outage, upstream 5xx).
 *   Logged at error, but never a bug in our code.
 *
 * Mirrors the fault classification in `services/aigateway/adapters/httpapi/faults.go`.
 */
export type HandledErrorFault = "customer" | "platform" | "provider";

export interface SerializedReason {
  code: string;
  /**
   * @deprecated Back-compat alias of `code`, emitted during the
   * `DomainError` → `HandledError` transition so clients still reading the old
   * `kind` discriminant keep working. Read `code` in new code; this alias is
   * removed once no consumer reads `kind`.
   */
  kind: string;
  fault?: HandledErrorFault;
  traceId?: string;
  spanId?: string;
  meta?: Record<string, unknown>;
  tips?: readonly string[];
  docsUrl?: string;
  reasons?: SerializedReason[];
}

/**
 * Serialised, client-safe shape of a {@link HandledError}. Mirrors the Go
 * `herr.E` (`pkg/herr`): `code`/`meta`/`traceId`/`spanId`/`reasons` line up
 * field-for-field with `Code`/`Meta`/`TraceID`/`SpanID`/`Reasons`. `httpStatus`
 * and `traceUrl` are TypeScript-side conveniences with no `herr.E` equivalent
 * (Go maps code→status via a registry and builds the trace link elsewhere).
 *
 * `fault`, `tips` and `docsUrl` are the remediation channel: they let API,
 * CLI and MCP consumers (agents!) self-diagnose without a human interpreting
 * the error. All three are additive — older clients ignore them.
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
  fault: HandledErrorFault;
  tips?: readonly string[];
  docsUrl?: string;
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
export type TraceUrlProvider = (
  traceId: string | undefined,
) => string | undefined;

let traceUrlProvider: TraceUrlProvider = () => undefined;

export function setTraceUrlProvider(provider: TraceUrlProvider): void {
  traceUrlProvider = provider;
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
 * For the broader "is this handled at all?" question, call
 * {@link HandledError.isHandled} rather than `instanceof HandledError`: it also
 * matches instances whose class identity a bundler duplicated, which bare
 * `instanceof` misses (see {@link hasHandledErrorBrand}).
 *
 * `meta` carries domain-specific context (e.g. `{ spanId }`) included in the
 * serialised shape. `httpStatus` is the suggested HTTP response code (defaults
 * to 500; subclasses set appropriate defaults). `traceId` / `spanId` are
 * captured automatically from the active OTel span. `reasons` serialises nested
 * HandledErrors by code and masks everything else as `{ code: "unknown" }`.
 *
 * `fault` says who's responsible (defaults to `"customer"` — annotate 5xx-ish
 * subclasses as `"platform"`/`"provider"` so incidents keep logging at error).
 * `tips` and `docsUrl` are the self-diagnosis channel for agents hitting the
 * API/CLI/MCP: short, actionable remediation steps and a link to the relevant
 * (markdown) doc. They serialise verbatim and are safe to show any client.
 *
 * Serialised shape:
 * ```json
 * {
 *   "code": "span_not_found",
 *   "meta": { "spanId": "abc" },
 *   "traceId": "...",
 *   "spanId": "...",
 *   "httpStatus": 404,
 *   "fault": "customer",
 *   "tips": ["Check the span id — spans expire after the retention window"],
 *   "docsUrl": "https://docs.langwatch.ai/...",
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
  readonly fault: HandledErrorFault;
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
  static toUserMessage(
    error: unknown,
    log?: (error: unknown) => void,
  ): string {
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
  return (
    error instanceof Error &&
    (error as { isHandled?: unknown }).isHandled === true
  );
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
    return {
      code: error.code,
      // Deprecated back-compat alias — see SerializedReason.kind.
      kind: error.code,
      fault: error.fault,
      ...(error.traceId ? { traceId: error.traceId } : {}),
      ...(error.spanId ? { spanId: error.spanId } : {}),
      ...(Object.keys(error.meta).length > 0 && { meta: error.meta }),
      ...(error.tips.length > 0 && { tips: error.tips }),
      ...(error.docsUrl ? { docsUrl: error.docsUrl } : {}),
      ...(error.reasons.length > 0 && {
        reasons: error.reasons.map(serializeReason),
      }),
    };
  }
  return { code: "unknown", kind: "unknown" };
}

/** Options shared by the convenience subclasses below. */
export interface HandledErrorOptions {
  meta?: Record<string, unknown>;
  fault?: HandledErrorFault;
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

/**
 * Structural stand-in for zod's `ZodError`. The package is consumed by the app
 * (zod 3.x classic), mcp-server (zod 4) and SDKs — importing `ZodError` from
 * any single zod version makes the other versions' errors unassignable. Any
 * error with zod's `flatten()` shape qualifies.
 */
export interface ZodLikeError {
  message: string;
  flatten(): {
    formErrors: string[];
    fieldErrors: Record<string, string[] | undefined>;
  };
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
