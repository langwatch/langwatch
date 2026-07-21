/**
 * The failure contract between the platform, the CLI and the Langy panel.
 *
 * The API already speaks a precise language of failure: server-side, a
 * `DomainError` carries a `kind` ("dataset_not_found", "validation_error"), an
 * HTTP status and a `meta` bag, and `handleError` flattens it onto the wire as:
 *
 *     HTTP <httpStatus>   { "error": <kind>, "message": <message>, ...meta }
 *
 * By the time that reaches the CLI it has usually been mashed back down into a
 * single English string, and the panel can only print it. That is a real loss: a
 * 404 "dataset not found" is a fact the UI can act on (offer to list what does
 * exist); a 500 is not. So the CLI reads the wire shape back into the structured
 * error it always was and puts THAT on the event — kind and status as their own
 * attributes — rather than flattening a structured failure into prose twice.
 *
 * The split that matters is domain vs infrastructure:
 *   - a domain error is the platform saying "no, and here is precisely why" — the
 *     user's problem, actionable, safe to show, worth a card;
 *   - anything else (a dead socket, a 500, a proxy's HTML error page) is OUR
 *     problem, and the panel must say so rather than blame the user.
 *
 * DELIBERATELY ZOD-FREE, and importable on its own (`@langwatch/cli-cards/domain-error`).
 * This module sits on the CLI's hot path: every instrumented command imports it,
 * including the overwhelming majority of runs where telemetry is switched off.
 * Importing zod here costs ~28ms on EVERY `langwatch` invocation — measured — and
 * a shape check this small does not need a schema engine to do it. The card
 * schemas, which are zod and which nothing on the hot path imports, live next
 * door.
 */

/**
 * One link in the platform's `reasons` chain — the failure BEHIND the failure.
 * Recursive, and named by kind only: the platform masks anything it did not
 * raise itself as `{ kind: "unknown" }` rather than leaking an internal message.
 */
export interface CliDomainErrorReason {
  kind: string;
  meta?: Record<string, unknown>;
  reasons?: CliDomainErrorReason[];
}

/** A failure, read back into the structure the platform originally gave it. */
export interface CliDomainError {
  /** The platform's serialisable discriminant, e.g. `dataset_not_found`. */
  kind: string;
  /** The human sentence. Safe to show: the platform wrote it for a user. */
  message: string;
  /** The status the platform answered with; 0 when the request never landed. */
  httpStatus: number;
  /** Whatever context the platform attached to the failure (ids, field errors). */
  meta: Record<string, unknown>;
  /**
   * True when the platform answered with a structured domain failure — i.e. it
   * understood the request and declined it. False for infrastructure failures,
   * where the CLI is guessing and the panel must not present it as the user's
   * fault.
   */
  isDomain: boolean;
  /**
   * The OTel trace the failure happened on, when the route sent it.
   *
   * Absent on most of the REST surface: the shared Hono handler
   * (`app/api/middleware/error-handler.ts`) flattens a DomainError to
   * `{ error, message, ...meta }` and drops `telemetry` on the floor. Routes
   * that forward the platform's `serialize()` verbatim DO carry it, so this is
   * read when offered and simply absent otherwise — never fabricated.
   */
  traceId?: string;
  /** The reason chain, when the route sent it. Same availability as `traceId`. */
  reasons?: CliDomainErrorReason[];
}

/** Anything at or above this is the platform failing, not the caller. */
const SERVER_ERROR_STATUS = 500;

/**
 * Kinds the platform uses when it has NOT actually named a domain failure — the
 * generic 500 lane of `handleError`. They matter because the status is not always
 * recoverable: some of the SDK's service wrappers surface the error body without
 * the `Response` it came on. When that happens the kind is the only thing left to
 * judge by, and these are the kinds that mean "we fell over", not "you asked for
 * something that cannot be done".
 */
const GENERIC_KINDS = new Set([
  "internal server error",
  "internal_error",
  "unknown",
  "unknown error",
]);

const isGenericKind = (kind: string): boolean =>
  GENERIC_KINDS.has(kind.trim().toLowerCase());

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** The reason chain, defensively: anything without a `kind` is not a reason. */
const asReasons = (value: unknown): CliDomainErrorReason[] | undefined => {
  if (!Array.isArray(value)) return undefined;

  const reasons = value
    .map(asRecord)
    .filter(
      (r): r is Record<string, unknown> => !!r && typeof r.kind === "string",
    )
    .map((r) => ({
      kind: r.kind as string,
      ...(asRecord(r.meta) ? { meta: asRecord(r.meta)! } : {}),
      ...(asReasons(r.reasons) ? { reasons: asReasons(r.reasons) } : {}),
    }));

  return reasons.length > 0 ? reasons : undefined;
};

interface ErrorBody {
  kind: string;
  message?: string;
  meta: Record<string, unknown>;
  traceId?: string;
  reasons?: CliDomainErrorReason[];
}

/**
 * Read the platform's error body. The REST surface speaks this in two dialects,
 * and both are real — verified against the routes, not assumed:
 *
 *   1. THE COMMON ONE, from the shared Hono error handler every `SecuredApp`
 *      mounts (`app/api/middleware/error-handler.ts`): the DomainError is
 *      FLATTENED to `{ error: <kind>, message: <sentence>, ...meta }` — meta
 *      spread across the top level, and `telemetry`/`reasons` dropped entirely.
 *      So `error` is the KIND here, not the sentence.
 *
 *   2. THE VERBATIM ONE, from routes that forward `DomainError.serialize()`
 *      whole (e.g. `routes/scenario-generate.ts`):
 *      `{ error: <sentence>, domainError: { kind, meta, telemetry, reasons } }`.
 *      This is the only dialect that keeps the trace id and the reason chain.
 *
 * A route that names the kind explicitly (`{ error: <sentence>, kind, meta }`,
 * as `routes/evaluations-legacy.ts` does) is read correctly too: an explicit
 * `kind` always wins, which means `error` is free to be the sentence.
 *
 *   3. THE VERSIONED ONE, from `packages/api`: `{ code, type, kind,
 *      message: <code>, meta: {…}, reasons, fault, tips, docsUrl }` — meta is a
 *      NESTED object here, not spread, and `message` is the code rather than a
 *      sentence (a handled error's own message is server copy and never crosses
 *      the boundary — ADR-045). Prose, when the server deliberately authored
 *      some, arrives as `meta.message`.
 *
 * The discriminant is read as `code` → `kind` → `type` → `error`. `code` is the
 * name TypeScript uses, `type` the OpenAI-compatible name Go emits; the
 * platform sets them to the same value, so the order only decides which one
 * answers first.
 */
const asErrorBody = (value: unknown): ErrorBody | null => {
  const record = asRecord(value);
  if (!record) return null;

  // Dialect 3: nested `meta` means the body is already structured — read it
  // directly instead of lifting the envelope's own fields into meta.
  const nestedMeta = asRecord(record.meta);
  const structuredCode =
    typeof record.code === "string"
      ? record.code
      : typeof record.type === "string"
        ? record.type
        : null;
  if (nestedMeta && structuredCode !== null) {
    // `message` equal to the code carries no information; treat it as absent so
    // callers fall through to their own copy.
    const authored = nestedMeta.message;
    const sentence =
      typeof authored === "string" && authored.length > 0
        ? authored
        : typeof record.message === "string" && record.message !== structuredCode
          ? record.message
          : undefined;
    return {
      kind: structuredCode,
      message: sentence,
      meta: nestedMeta,
      traceId: typeof record.traceId === "string" ? record.traceId : undefined,
      reasons: asReasons(record.reasons),
    };
  }

  // Dialect 2: the serialised DomainError, carried whole under `domainError`.
  const serialized = asRecord(record.domainError);
  if (serialized && typeof serialized.kind === "string") {
    const telemetry = asRecord(serialized.telemetry);
    return {
      kind: serialized.kind,
      message:
        typeof record.error === "string"
          ? record.error
          : typeof record.message === "string"
            ? record.message
            : undefined,
      meta: asRecord(serialized.meta) ?? {},
      traceId:
        typeof telemetry?.traceId === "string" ? telemetry.traceId : undefined,
      reasons: asReasons(serialized.reasons),
    };
  }

  // Dialect 1 (and the explicit-`kind` variant). One of these must name the
  // failure; without any, this is not the platform's shape at all.
  const named =
    typeof record.code === "string"
      ? record.code
      : typeof record.kind === "string"
        ? record.kind
        : typeof record.type === "string"
          ? record.type
          : typeof record.error === "string"
            ? record.error
            : null;
  if (named === null) return null;

  // Everything the platform did NOT put in meta gets lifted out, so the flat
  // spread does not smuggle the envelope's own fields back in as domain context.
  // `code`/`type` are discriminants, not context — they belong here too.
  const {
    error,
    message,
    kind,
    code,
    type,
    telemetry,
    reasons,
    traceId,
    ...rest
  } = record;

  // When the failure was named by something other than `error`, `error` is free
  // to be the sentence. A `message` equal to the code carries no information.
  const sentence =
    typeof message === "string" && message !== named
      ? message
      : typeof error === "string" && error !== named
        ? error
        : undefined;

  const telemetryRecord = asRecord(telemetry);

  return {
    kind: named,
    message: sentence,
    meta: rest,
    traceId:
      typeof telemetryRecord?.traceId === "string"
        ? telemetryRecord.traceId
        : typeof traceId === "string"
          ? traceId
          : undefined,
    reasons: asReasons(reasons),
  };
};

/** A stable kind for a failure the platform did not name itself. */
const kindForStatus = (status: number): string => {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= SERVER_ERROR_STATUS) return "internal_error";
  if (status > 0) return "request_failed";
  return "network_error";
};

const fallbackMessage = ({
  status,
  body,
}: {
  status: number;
  body: unknown;
}): string => {
  if (typeof body === "string" && body.trim()) return body.trim().slice(0, 300);
  return status > 0 ? `Request failed with status ${status}` : "Request failed";
};

/**
 * Read an HTTP failure back into a {@link CliDomainError}.
 *
 * A body in the platform's error shape that came back BELOW 500 is a true domain
 * error and keeps its kind. A 5xx, or a body that is not the platform's shape at
 * all (a gateway's HTML, a truncated response), is infrastructure: it still
 * yields a usable error, but `isDomain` is false and the kind degrades to a
 * status-derived one rather than a fabricated domain kind.
 */
export const parseDomainError = ({
  status,
  body,
}: {
  status: number;
  body: unknown;
}): CliDomainError => {
  const parsed = asErrorBody(body);

  if (!parsed) {
    return {
      kind: kindForStatus(status),
      message: fallbackMessage({ status, body }),
      httpStatus: status,
      meta: {},
      isDomain: false,
    };
  }

  return {
    kind: parsed.kind,
    message: parsed.message ?? parsed.kind,
    httpStatus: status,
    meta: parsed.meta,
    ...(parsed.traceId ? { traceId: parsed.traceId } : {}),
    ...(parsed.reasons ? { reasons: parsed.reasons } : {}),
    // The platform names its own failures; a 5xx names ours, whatever the body
    // says. Trusting a 500's "kind" would let an infrastructure outage present
    // itself to the user as though they had done something wrong.
    //
    // With no status to go on, the kind decides: the platform only emits a
    // generic kind when it fell over, so anything more specific than that is a
    // failure it chose to name — which is exactly what a domain error is.
    isDomain:
      status > 0
        ? status < SERVER_ERROR_STATUS
        : !isGenericKind(parsed.kind),
  };
};

/**
 * The document the CLI prints on stdout when a command fails under
 * `--format json`, and the one the panel reads back.
 *
 * A machine caller — Langy runs the CLI in a shell and parses its stdout — got
 * nothing but prose on the error path before this: the failure was a red line on
 * stderr and an exit code, so an agent could see THAT a command failed and never
 * WHY. It would then guess, and usually guess "retry". A `kind` it can match on
 * is the difference between retrying a transient failure and stopping dead on a
 * terminal one.
 *
 * `ok: false` is the discriminant. A success document is the bare card object
 * (see `parseCliResult`), so nothing else on stdout carries it.
 */
export interface CliErrorDocument {
  ok: false;
  error: CliDomainError;
}

/** Build the `--format json` failure document. */
export const toCliErrorDocument = (
  error: CliDomainError,
): CliErrorDocument => ({ ok: false, error });

/**
 * Read a CLI failure document back, or null when the output is not one.
 *
 * Null-on-miss rather than throw: stdout may hold a card, a human table, or
 * nothing at all, and none of those is an error document.
 */
export const readCliErrorDocument = (
  output: unknown,
): CliDomainError | null => {
  const document =
    typeof output === "string" ? safeParseJson(output) : asRecord(output);

  const record = asRecord(document);
  if (!record || record.ok !== false) return null;

  const error = asRecord(record.error);
  if (!error || typeof error.kind !== "string") return null;

  return {
    kind: error.kind,
    message: typeof error.message === "string" ? error.message : error.kind,
    httpStatus: typeof error.httpStatus === "number" ? error.httpStatus : 0,
    meta: asRecord(error.meta) ?? {},
    isDomain: error.isDomain === true,
    ...(typeof error.traceId === "string" ? { traceId: error.traceId } : {}),
    ...(asReasons(error.reasons) ? { reasons: asReasons(error.reasons) } : {}),
  };
};

const safeParseJson = (value: string): unknown => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
};

/**
 * A `LangWatchDomainError` — an error the SDK's transport ALREADY read the wire
 * into. It brands itself with a boolean rather than relying on `instanceof`,
 * which does not survive a bundled CLI meeting a consumer's own copy of the SDK.
 */
const asAlreadyReadDomainError = (
  outer: Record<string, unknown> | null,
): CliDomainError | null => {
  if (!outer || outer.isLangWatchDomainError !== true) return null;
  if (typeof outer.kind !== "string") return null;

  return {
    kind: outer.kind,
    message: typeof outer.message === "string" ? outer.message : outer.kind,
    httpStatus: typeof outer.httpStatus === "number" ? outer.httpStatus : 0,
    meta: asRecord(outer.meta) ?? {},
    isDomain: true,
    ...(typeof outer.traceId === "string" ? { traceId: outer.traceId } : {}),
    ...(asReasons(outer.reasons) ? { reasons: asReasons(outer.reasons) } : {}),
  };
};

/**
 * The status an error carries, wherever it chose to put it. The SDK's HTTP layer,
 * its service wrappers and `fetch` each spell this differently.
 */
const statusOf = (value: Record<string, unknown> | null): number => {
  if (!value) return 0;
  if (typeof value.status === "number") return value.status;
  if (typeof value.statusCode === "number") return value.statusCode;
  if (typeof value.httpStatus === "number") return value.httpStatus;

  const response = asRecord(value.response);
  if (response && typeof response.status === "number") return response.status;

  return 0;
};

/**
 * The same reading, for an error that was THROWN rather than returned — the shape
 * the SDK's service layer raises.
 *
 * Those wrappers (`TracesApiError` and friends) flatten the API's body into an
 * English sentence for the console but keep the original alongside it, so the
 * structure is recoverable: unwrap to the innermost cause and read the wire shape
 * off that. Without this the CLI would report every failure as a generic string
 * and the panel would lose the one thing it can act on — the kind.
 *
 * Anything unrecognisable becomes a non-domain error carrying its own message,
 * which is the honest answer: we do not know what went wrong, so we do not claim
 * a kind we cannot substantiate.
 */
export const domainErrorFromThrown = (error: unknown): CliDomainError => {
  const outer = asRecord(error);

  // The SDK's HTTP layer may have read this already, into a richer structure than
  // the wire body it came from: the flattened body carries no trace id and no
  // reason chain, so re-deriving from it would THROW AWAY the two fields the
  // typed error exists to preserve. Trust the reading that already happened.
  const alreadyRead = asAlreadyReadDomainError(outer);
  if (alreadyRead) return alreadyRead;

  // The SDK wraps the API's error body; the body is the thing worth reading.
  const cause =
    asRecord(outer?.originalError) ??
    asRecord(outer?.cause) ??
    asRecord(outer?.body) ??
    outer;

  const status = statusOf(cause) || statusOf(outer);
  const parsed = parseDomainError({ status, body: cause });

  if (parsed.isDomain) return parsed;

  return {
    ...parsed,
    message:
      error instanceof Error && error.message ? error.message : parsed.message,
  };
};
