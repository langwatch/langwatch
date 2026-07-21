/**
 * The failure contract between the platform, the CLI and the Langy panel.
 *
 * The API already speaks a precise language of failure: server-side, a
 * `HandledError` carries a `code` ("dataset_not_found", "validation_error"), an
 * HTTP status and a `meta` bag, and `handleError` flattens it onto the wire as:
 *
 *     HTTP <httpStatus>   { "error": <code>, "message": <message>, ...meta }
 *
 * By the time that reaches the CLI it has usually been mashed back down into a
 * single English string, and the panel can only print it. That is a real loss: a
 * 404 "dataset not found" is a fact the UI can act on (offer to list what does
 * exist); a 500 is not. So the CLI reads the wire shape back into the structured
 * error it always was and puts THAT on the event — code and status as their own
 * attributes — rather than flattening a structured failure into prose twice.
 *
 * The split that matters is domain vs infrastructure:
 *   - a domain error is the platform saying "no, and here is precisely why" — the
 *     user's problem, actionable, safe to show, worth a card;
 *   - anything else (a dead socket, a 500, a proxy's HTML error page) is OUR
 *     problem, and the panel must say so rather than blame the user.
 *
 * DELIBERATELY ZOD-FREE, and importable on its own (`@langwatch/cli-cards/handled-error`).
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
 * raise itself as `{ code: "unknown" }` rather than leaking an internal message.
 */
export interface CliHandledErrorReason {
  kind: string;
  meta?: Record<string, unknown>;
  reasons?: CliHandledErrorReason[];
}

/** A failure, read back into the structure the platform originally gave it. */
export interface CliHandledError {
  /** The platform's serialisable discriminant, e.g. `dataset_not_found`. */
  code: string;
  /**
   * @deprecated Back-compat alias of `code`, emitted while the platform's
   * `DomainError` → `HandledError` rename rolls out (the serialised error
   * carries the same pair — see `SerializedHandledError.kind`). Read `code` in
   * new code; this alias is removed once no consumer reads `kind`.
   */
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
  isHandled: boolean;
  /**
   * The OTel trace the failure happened on, when the route sent it.
   *
   * Read when offered and simply absent otherwise — never fabricated. It now
   * survives all three REST dialects: the shared Hono handler nests it under
   * `trace: { traceId, … }`, and the routes that forward `serialize()` (or the
   * new framework envelope) carry it top-level.
   */
  traceId?: string;
  /** A clickable link to that trace, when the route sent one. */
  traceUrl?: string;
  /** A clickable link to the logs for that trace, when the route sent one. */
  logsUrl?: string;
  /** The reason chain, when the route sent it. Same availability as `traceId`. */
  reasons?: CliHandledErrorReason[];
  /**
   * What the user can DO about it — the platform's own next steps.
   *
   * The platform spells this `tips` (`HandledError.tips`, authored centrally in
   * `server/app-layer/error-remediation.ts` and keyed by code, with its docs
   * paths verified by CI). It is read here under both names: `tips` is what the
   * wire actually carries, `suggestions` is kept because the CLI's own error
   * document has always written that name and older documents must keep
   * parsing.
   *
   * This is the remediation channel ADR-045 added for exactly this consumer —
   * `specs/features/domain-error-contract.feature` requires that "consumers
   * without a client-side explainer (CLI, API, MCP) can self-diagnose". When
   * the server sends these they WIN over the CLI's own code-keyed fallback,
   * which only knows a handful of generic codes and cannot know, say, that
   * traces are deleted after the retention window.
   */
  suggestions?: string[];
  /** The docs page that explains the failure (`docsUrl` on the wire). */
  docUrl?: string;
}

/** Anything at or above this is the platform failing, not the caller. */
const SERVER_ERROR_STATUS = 500;

/**
 * Codes the platform uses when it has NOT actually named a domain failure — the
 * generic 500 lane of `handleError`. They matter because the status is not always
 * recoverable: some of the SDK's service wrappers surface the error body without
 * the `Response` it came on. When that happens the code is the only thing left to
 * judge by, and these are the codes that mean "we fell over", not "you asked for
 * something that cannot be done".
 */
const GENERIC_CODES = new Set([
  "internal server error",
  "internal_error",
  "unknown",
  "unknown error",
]);

const isGenericCode = (code: string): boolean =>
  GENERIC_CODES.has(code.trim().toLowerCase());

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** The reason chain, defensively: anything without a code is not a reason. */
const asReasons = (value: unknown): CliHandledErrorReason[] | undefined => {
  if (!Array.isArray(value)) return undefined;

  const reasons = value
    .map(asRecord)
    .filter(
      (r): r is Record<string, unknown> =>
        !!r && (typeof r.code === "string" || typeof r.kind === "string"),
    )
    .map((r) => ({
      kind: (typeof r.code === "string" ? r.code : r.kind) as string,
      ...(asRecord(r.meta) ? { meta: asRecord(r.meta)! } : {}),
      ...(asReasons(r.reasons) ? { reasons: asReasons(r.reasons) } : {}),
    }));

  return reasons.length > 0 ? reasons : undefined;
};

/**
 * A libuv/Node system error, not a platform error body.
 *
 * `fetch` reports a transport failure by throwing a `TypeError("fetch failed")`
 * whose `cause` is the system error, and `handledErrorFromThrown` unwraps to that
 * cause. Its own enumerable keys are `{ errno, code, syscall, address, port }` —
 * so its `code` is `ECONNREFUSED`/`ENOTFOUND`/`ETIMEDOUT`/a TLS cert code, NOT a
 * discriminant the platform ever chose. Reading one as a domain error is the
 * worst kind of wrong: it blames the user for the network being down, and it
 * lifts the local `address`/`port` into `meta` as though they were domain
 * context. `errno`/`syscall` are the tell, and no platform envelope carries
 * them, so their presence disqualifies the record outright — a transport
 * failure is infrastructure, always.
 */
const isSystemError = (record: Record<string, unknown>): boolean =>
  "errno" in record || "syscall" in record;

/**
 * Does this record look like the platform's envelope at all?
 *
 * Only asked of a BARE top-level `code` — the one field a system error shares
 * with dialect 3. The platform never sends a lone `code`: its envelope always
 * carries the sentence, the meta bag, or the deprecated `kind` alongside it. So
 * a `code` with none of them is not the platform speaking, and is not trusted to
 * name a domain failure.
 */
const looksLikeErrorEnvelope = (record: Record<string, unknown>): boolean =>
  "message" in record || "meta" in record || "kind" in record;

/** Next steps, defensively: only real strings survive. */
const asSuggestions = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const suggestions = value.filter(
    (s): s is string => typeof s === "string" && s.trim().length > 0,
  );
  return suggestions.length > 0 ? suggestions : undefined;
};

interface ErrorBody {
  code: string;
  message?: string;
  meta: Record<string, unknown>;
  traceId?: string;
  traceUrl?: string;
  logsUrl?: string;
  reasons?: CliHandledErrorReason[];
  suggestions?: string[];
  docUrl?: string;
}

/**
 * Read the platform's error body. The REST surface speaks this in THREE
 * dialects, and all are real — verified against the routes, not assumed:
 *
 *   1. THE COMMON ONE, from the shared Hono error handler every `SecuredApp`
 *      mounts (`app/api/middleware/error-handler.ts`): the HandledError is
 *      FLATTENED to `{ error: <code>, message: <sentence>, ...meta }` — meta
 *      spread across the top level, and `reasons`/`traceUrl` dropped entirely.
 *      So `error` is the CODE here, not the sentence. The trace ids survive,
 *      but nested: `trace: { traceId, spanId, traceUrl?, logsUrl? }`.
 *
 *   2. THE VERBATIM ONE, from routes that forward `HandledError.serialize()`
 *      whole (e.g. `routes/scenario-generate.ts`):
 *      `{ error: <sentence>, domainError: { code, kind, meta, traceId, reasons } }`.
 *
 *   3. THE FRAMEWORK ONE, from the new API framework
 *      (`langwatch/packages/api/src/errors.ts`): the envelope top-level —
 *      `{ code, type, kind, message, meta, reasons, traceId, spanId, traceUrl }`,
 *      with `error` carrying the HTTP status text on unversioned routes. `meta`
 *      is a NESTED object here rather than spread, and `message` is usually the
 *      code rather than a sentence: a handled error's own message is server copy
 *      and never crosses the boundary (ADR-045). Prose, when the server
 *      deliberately authored some, arrives as `meta.message` and wins.
 *
 * `code` is the name TypeScript uses, `type` the OpenAI-compatible name Go
 * emits; the framework sets all three to the same value (`errors.ts` assigns
 * `body.kind = body.code` and `body.type = body.code`), so which one answers
 * first only decides anything when a writer sent just one of them.
 *
 * A route that names the code explicitly under the deprecated `kind` only (an
 * older server, mid-rename) is read correctly too: `code ?? kind` always wins,
 * which means `error` is free to be the sentence.
 */
const asErrorBody = (value: unknown): ErrorBody | null => {
  const record = asRecord(value);
  if (!record) return null;

  // A libuv system error is a transport failure wearing a `code`. It is never
  // any of the three dialects, whatever else it carries, so it never gets to
  // name a domain failure — it falls through to the status-derived reading,
  // which calls it `network_error` and means it.
  if (isSystemError(record)) return null;

  // Dialect 2: the serialised HandledError, carried whole under `domainError`.
  const serialized = asRecord(record.domainError);
  if (
    serialized &&
    (typeof serialized.code === "string" || typeof serialized.kind === "string")
  ) {
    const telemetry = asRecord(serialized.telemetry);
    return {
      code:
        typeof serialized.code === "string"
          ? serialized.code
          : (serialized.kind as string),
      message:
        typeof record.error === "string"
          ? record.error
          : typeof record.message === "string"
            ? record.message
            : undefined,
      meta: asRecord(serialized.meta) ?? {},
      traceId:
        typeof serialized.traceId === "string"
          ? serialized.traceId
          : typeof telemetry?.traceId === "string"
            ? telemetry.traceId
            : undefined,
      traceUrl:
        typeof serialized.traceUrl === "string" ? serialized.traceUrl : undefined,
      logsUrl:
        typeof serialized.logsUrl === "string" ? serialized.logsUrl : undefined,
      reasons: asReasons(serialized.reasons),
      suggestions:
        asSuggestions(serialized.tips) ?? asSuggestions(serialized.suggestions),
      docUrl:
        typeof serialized.docsUrl === "string"
          ? serialized.docsUrl
          : typeof serialized.docUrl === "string"
            ? serialized.docUrl
            : undefined,
    };
  }

  // Dialects 1 and 3 (and the deprecated `kind`-only variant). One of them must
  // name the failure; without any, this is not the platform's shape at all.
  //
  // The ordering guards a hijack: dialect 1 spreads meta FLAT, so a meta bag
  // holding a literal `code` (or `type`) key would shadow the real discriminant
  // on `error` if it were read first. Dialect 3 always emits `kind` alongside
  // `code`, so a `kind` present means the envelope named itself and wins; with
  // no `kind`, `error` is the dialect-1 discriminant and a bare `code`/`type` is
  // only trusted when nothing else named the failure — and only then if the
  // record looks like the platform's envelope at all, so a stray `code`/`type`
  // on some other object cannot pass itself off as a discriminant the platform
  // chose.
  //
  // `type` sits at the same trust tier as `code` throughout: it is the same
  // value under the OpenAI-compatible name Go writes, so a writer that sent only
  // `type` must still resolve to the same failure — and must clear the same
  // envelope check, since `type` is a far more common field on ordinary objects
  // than `code` is.
  const named =
    typeof record.kind === "string"
      ? typeof record.code === "string"
        ? record.code
        : typeof record.type === "string"
          ? record.type
          : record.kind
      : typeof record.error === "string"
        ? record.error
        : looksLikeErrorEnvelope(record)
          ? typeof record.code === "string"
            ? record.code
            : typeof record.type === "string"
              ? record.type
              : null
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
    meta: explicitMeta,
    telemetry,
    trace,
    reasons,
    traceId,
    spanId,
    traceUrl,
    logsUrl,
    suggestions,
    docUrl,
    // The platform's own spelling of the two above. Lifted out for the same
    // reason as the rest: dialect 1 spreads meta flat, so leaving them in would
    // report the remediation copy back as domain context.
    tips,
    docsUrl,
    // `fault` is the envelope's own ("customer" vs "platform"), not something
    // the platform attached to this failure.
    fault,
    ...rest
  } = record;

  const nestedMeta = asRecord(explicitMeta);

  // The sentence, in order of how much the server meant it. Dialect 3's own
  // `message` is usually just the code echoed back — server copy never crosses
  // the boundary (ADR-045) — so prose the server deliberately authored under
  // `meta.message` wins outright. Failing that, `message` then `error` are the
  // sentence, but only when they are not simply repeating the discriminant:
  // a value equal to `named` carries no information a caller does not already
  // have, and passing it through would print the code where prose belongs.
  const authored = nestedMeta?.message;
  const sentence =
    typeof authored === "string" && authored.length > 0
      ? authored
      : typeof message === "string" && message !== named
        ? message
        : typeof error === "string" && error !== named
          ? error
          : undefined;

  const telemetryRecord = asRecord(telemetry);
  const traceRecord = asRecord(trace);

  return {
    code: named,
    message: sentence,
    // Dialect 3 carries meta as its own key; dialect 1 spreads it flat.
    meta: nestedMeta ?? rest,
    traceId:
      typeof traceRecord?.traceId === "string"
        ? traceRecord.traceId
        : typeof telemetryRecord?.traceId === "string"
          ? telemetryRecord.traceId
          : typeof traceId === "string"
            ? traceId
            : undefined,
    traceUrl:
      typeof traceUrl === "string"
        ? traceUrl
        : typeof traceRecord?.traceUrl === "string"
          ? traceRecord.traceUrl
          : undefined,
    logsUrl:
      typeof logsUrl === "string"
        ? logsUrl
        : typeof traceRecord?.logsUrl === "string"
          ? traceRecord.logsUrl
          : undefined,
    reasons: asReasons(reasons),
    suggestions: asSuggestions(tips) ?? asSuggestions(suggestions),
    docUrl:
      typeof docsUrl === "string"
        ? docsUrl
        : typeof docUrl === "string"
          ? docUrl
          : undefined,
  };
};

/** A stable code for a failure the platform did not name itself. */
const codeForStatus = (status: number): string => {
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
 * Read an HTTP failure back into a {@link CliHandledError}.
 *
 * A body in the platform's error shape that came back BELOW 500 is a true domain
 * error and keeps its code. A 5xx, or a body that is not the platform's shape at
 * all (a gateway's HTML, a truncated response), is infrastructure: it still
 * yields a usable error, but `isHandled` is false and the code degrades to a
 * status-derived one rather than a fabricated domain code.
 */
export const parseHandledError = ({
  status,
  body,
}: {
  status: number;
  body: unknown;
}): CliHandledError => {
  const parsed = asErrorBody(body);

  if (!parsed) {
    return {
      code: codeForStatus(status),
      kind: codeForStatus(status),
      message: fallbackMessage({ status, body }),
      httpStatus: status,
      meta: {},
      isHandled: false,
    };
  }

  return {
    code: parsed.code,
    // Deprecated back-compat alias — see CliHandledError.kind.
    kind: parsed.code,
    message: parsed.message ?? parsed.code,
    httpStatus: status,
    meta: parsed.meta,
    ...(parsed.traceId ? { traceId: parsed.traceId } : {}),
    ...(parsed.traceUrl ? { traceUrl: parsed.traceUrl } : {}),
    ...(parsed.logsUrl ? { logsUrl: parsed.logsUrl } : {}),
    ...(parsed.reasons ? { reasons: parsed.reasons } : {}),
    ...(parsed.suggestions ? { suggestions: parsed.suggestions } : {}),
    ...(parsed.docUrl ? { docUrl: parsed.docUrl } : {}),
    // The platform names its own failures; a 5xx names ours, whatever the body
    // says. Trusting a 500's "code" would let an infrastructure outage present
    // itself to the user as though they had done something wrong.
    //
    // With no status to go on, the code decides: the platform only emits a
    // generic code when it fell over, so anything more specific than that is a
    // failure it chose to name — which is exactly what a domain error is.
    isHandled:
      status > 0
        ? status < SERVER_ERROR_STATUS
        : !isGenericCode(parsed.code),
  };
};

/**
 * The document the CLI prints on stdout when a command fails under
 * `--format json`, and the one the panel reads back.
 *
 * A machine caller — Langy runs the CLI in a shell and parses its stdout — got
 * nothing but prose on the error path before this: the failure was a red line on
 * stderr and an exit code, so an agent could see THAT a command failed and never
 * WHY. It would then guess, and usually guess "retry". A `code` it can match on
 * is the difference between retrying a transient failure and stopping dead on a
 * terminal one.
 *
 * `ok: false` is the discriminant. A success document is the bare card object
 * (see `parseCliResult`), so nothing else on stdout carries it.
 */
export interface CliErrorDocument {
  ok: false;
  error: CliHandledError;
}

/** Build the `--format json` failure document. */
export const toCliErrorDocument = (
  error: CliHandledError,
): CliErrorDocument => ({ ok: false, error });

/**
 * Read a CLI failure document back, or null when the output is not one.
 *
 * Null-on-miss rather than throw: stdout may hold a card, a human table, or
 * nothing at all, and none of those is an error document.
 */
export const readCliErrorDocument = (
  output: unknown,
): CliHandledError | null => {
  const document =
    typeof output === "string" ? safeParseJson(output) : asRecord(output);

  const record = asRecord(document);
  if (!record || record.ok !== false) return null;

  const error = asRecord(record.error);
  const code =
    typeof error?.code === "string"
      ? error.code
      : typeof error?.kind === "string"
        ? error.kind
        : null;
  if (!error || code === null) return null;

  return {
    code,
    // Deprecated back-compat alias — see CliHandledError.kind.
    kind: code,
    message: typeof error.message === "string" ? error.message : code,
    httpStatus: typeof error.httpStatus === "number" ? error.httpStatus : 0,
    meta: asRecord(error.meta) ?? {},
    isHandled: error.isHandled === true,
    ...(typeof error.traceId === "string" ? { traceId: error.traceId } : {}),
    ...(typeof error.traceUrl === "string" ? { traceUrl: error.traceUrl } : {}),
    ...(typeof error.logsUrl === "string" ? { logsUrl: error.logsUrl } : {}),
    ...(asReasons(error.reasons) ? { reasons: asReasons(error.reasons) } : {}),
    ...(asSuggestions(error.suggestions)
      ? { suggestions: asSuggestions(error.suggestions) }
      : {}),
    ...(typeof error.docUrl === "string" ? { docUrl: error.docUrl } : {}),
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
 * A `LangWatchHandledError` — an error the SDK's transport ALREADY read the wire
 * into. It brands itself with a boolean rather than relying on `instanceof`,
 * which does not survive a bundled CLI meeting a consumer's own copy of the SDK.
 */
const asAlreadyReadHandledError = (
  outer: Record<string, unknown> | null,
): CliHandledError | null => {
  if (!outer || outer.isLangWatchHandledError !== true) return null;
  const code =
    typeof outer.code === "string"
      ? outer.code
      : typeof outer.kind === "string"
        ? outer.kind
        : null;
  if (code === null) return null;

  return {
    code,
    // Deprecated back-compat alias — see CliHandledError.kind.
    kind: code,
    message: typeof outer.message === "string" ? outer.message : code,
    httpStatus: typeof outer.httpStatus === "number" ? outer.httpStatus : 0,
    meta: asRecord(outer.meta) ?? {},
    isHandled: true,
    ...(typeof outer.traceId === "string" ? { traceId: outer.traceId } : {}),
    ...(typeof outer.traceUrl === "string" ? { traceUrl: outer.traceUrl } : {}),
    ...(typeof outer.logsUrl === "string" ? { logsUrl: outer.logsUrl } : {}),
    ...(asReasons(outer.reasons) ? { reasons: asReasons(outer.reasons) } : {}),
    ...(asSuggestions(outer.suggestions)
      ? { suggestions: asSuggestions(outer.suggestions) }
      : {}),
    ...(typeof outer.docUrl === "string" ? { docUrl: outer.docUrl } : {}),
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
 * Those wrappers (`TracesApiError` and friends) flatten the API's error body into
 * an English sentence for the console but keep the original alongside it, so the
 * structure is recoverable: unwrap to the innermost cause and read the wire shape
 * off that. Without this the CLI would report every failure as a generic string
 * and the panel would lose the one thing it can act on — the code.
 *
 * Anything unrecognisable becomes a non-domain error carrying its own message,
 * which is the honest answer: we do not know what went wrong, so we do not claim
 * a code we cannot substantiate.
 */
export const handledErrorFromThrown = (error: unknown): CliHandledError => {
  const outer = asRecord(error);

  // The SDK's HTTP layer may have read this already, into a richer structure than
  // the wire body it came from: the flattened body carries no trace id and no
  // reason chain, so re-deriving from it would THROW AWAY the fields the typed
  // error exists to preserve. Trust the reading that already happened.
  const alreadyRead = asAlreadyReadHandledError(outer);
  if (alreadyRead) return alreadyRead;

  // The SDK wraps the API's error body; the body is the thing worth reading.
  const cause =
    asRecord(outer?.originalError) ??
    asRecord(outer?.cause) ??
    asRecord(outer?.body) ??
    outer;

  const status = statusOf(cause) || statusOf(outer);
  const parsed = parseHandledError({ status, body: cause });

  if (parsed.isHandled) return parsed;

  return {
    ...parsed,
    message:
      error instanceof Error && error.message ? error.message : parsed.message,
  };
};
