/**
 * The failure contract between the platform, the CLI and the Langy panel.
 */

/**
 * One link in the platform's `reasons` chain — the failure BEHIND the failure.
 * Recursive, and named by kind only: the platform masks anything it did not
 * raise itself as `{ code: "unknown" }` rather than leaking an internal message.
 */
export interface CliHandledErrorReason {
  kind: string;
  /** Whether retrying this underlying failure unchanged may succeed. */
  retryable: boolean;
  meta?: Record<string, unknown>;
  reasons?: CliHandledErrorReason[];
}

/** A failure, read back into the structure the platform originally gave it. */
export interface CliHandledError {
  /** The platform's serialisable discriminant, e.g. `dataset_not_found`. */
  code: string;
  /**
   * @deprecated Back-compat alias of `code`, emitted while the platform's
   */
  kind: string;
  /** The human sentence. Safe to show: the platform wrote it for a user. */
  message: string;
  /** The status the platform answered with; 0 when the request never landed. */
  httpStatus: number;
  /** Whatever context the platform attached to the failure (ids, field errors). */
  meta: Record<string, unknown>;
  /**
   * True when the platform answered with a structured domain failure — i.e. it understood the
   * request and declined it. False for infrastructure failures, where the CLI is guessing and
   * the panel must not present it as the user's fault.
   */
  isHandled: boolean;
  /** Whether the platform explicitly permits retrying the same request. */
  retryable: boolean;
  /**
   * The OTel trace the failure happened on, when the route sent it. Read when offered and
   * simply absent otherwise — never fabricated.
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
   * This is the remediation channel ADR-045 added for exactly this consumer —
   */
  suggestions?: string[];
  /** The docs page that explains the failure (`docsUrl` on the wire). */
  docUrl?: string;
}

/** Anything at or above this is the platform failing, not the caller. */
const SERVER_ERROR_STATUS = 500;

/**
 * Codes the platform uses when it has NOT actually named a domain failure — the generic 500
 * lane of `handleError`. They matter because the status is not always recoverable: some of the
 * SDK's service wrappers surface the error body without the `Response` it came on.
 */
const GENERIC_CODES = new Set([
  "internal server error",
  "internal_error",
  "unknown",
  "unknown error",
]);

const isGenericCode = (code: string): boolean => GENERIC_CODES.has(code.trim().toLowerCase());

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
      retryable: r.retryable === true,
      ...(asRecord(r.meta) ? { meta: asRecord(r.meta)! } : {}),
      ...(asReasons(r.reasons) ? { reasons: asReasons(r.reasons) } : {}),
    }));

  return reasons.length > 0 ? reasons : undefined;
};

/**
 * A libuv/Node system error, not a platform error body. `fetch` reports a transport failure by
 * throwing a `TypeError("fetch failed")` whose `cause` is the system error, and
 * `handledErrorFromThrown` unwraps to that cause.
 */
const isSystemError = (record: Record<string, unknown>): boolean =>
  "errno" in record || "syscall" in record;

/**
 * Does this record look like the platform's envelope at all? Only asked of a BARE top-level
 * `code` — the one field a system error shares with dialect 3.
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
  retryable: boolean;
  traceId?: string;
  traceUrl?: string;
  logsUrl?: string;
  reasons?: CliHandledErrorReason[];
  suggestions?: string[];
  docUrl?: string;
}

/**
 * Read the platform's error body. The REST surface speaks this in FOUR dialects, and all are
 * real — verified against the routes, not assumed: 1.
 *      and never crosses the boundary (ADR-045). Prose, when the server
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
  if (serialized && (typeof serialized.code === "string" || typeof serialized.kind === "string")) {
    const telemetry = asRecord(serialized.telemetry);
    return {
      code: typeof serialized.code === "string" ? serialized.code : (serialized.kind as string),
      message:
        typeof record.error === "string"
          ? record.error
          : typeof record.message === "string"
            ? record.message
            : undefined,
      meta: asRecord(serialized.meta) ?? {},
      retryable: serialized.retryable === true,
      traceId:
        typeof serialized.traceId === "string"
          ? serialized.traceId
          : typeof telemetry?.traceId === "string"
            ? telemetry.traceId
            : undefined,
      traceUrl: typeof serialized.traceUrl === "string" ? serialized.traceUrl : undefined,
      logsUrl: typeof serialized.logsUrl === "string" ? serialized.logsUrl : undefined,
      reasons: asReasons(serialized.reasons),
      suggestions: asSuggestions(serialized.tips) ?? asSuggestions(serialized.suggestions),
      docUrl:
        typeof serialized.docsUrl === "string"
          ? serialized.docsUrl
          : typeof serialized.docUrl === "string"
            ? serialized.docUrl
            : undefined,
    };
  }

  // Dialect 4: THE CANONICAL ONE, from the shared REST envelope (`app/api/shared/schemas.ts`)
  // that the analytics-sql families and every new canonical-envelope route answer with: `{
  // error: { type, code, message, meta?, trace_id?, span_id? } }` — the whole failure NESTED
  // under `error` as an object, so none of the flat readings below can see it.
  const canonical = asRecord(record.error);
  if (
    canonical &&
    !isSystemError(canonical) &&
    (typeof canonical.code === "string" || typeof canonical.type === "string")
  ) {
    const code = typeof canonical.code === "string" ? canonical.code : (canonical.type as string);
    const { reasons: metaReasons, ...meta } = asRecord(canonical.meta) ?? {};
    return {
      code,
      retryable: canonical.retryable === true,
      message:
        typeof canonical.message === "string" && canonical.message !== code
          ? canonical.message
          : undefined,
      meta,
      traceId: typeof canonical.trace_id === "string" ? canonical.trace_id : undefined,
      reasons: asReasons(metaReasons),
      suggestions: asSuggestions(canonical.tips) ?? asSuggestions(canonical.suggestions),
      docUrl: typeof canonical.docs_url === "string" ? canonical.docs_url : undefined,
    };
  }

  // Dialects 1 and 3 (and the deprecated `kind`-only variant). One of them must name the
  // failure; without any, this is not the platform's shape at all. The ordering guards a
  // hijack: dialect 1 spreads meta FLAT, so a meta bag holding a literal `code` (or `type`) key
  // would shadow the real discriminant on `error` if it were read first.
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
    kind: _kind,
    code: _code,
    type: _type,
    meta: explicitMeta,
    telemetry,
    trace,
    reasons,
    traceId,
    spanId: _spanId,
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
    fault: _fault,
    retryable,
    ...rest
  } = record;

  const nestedMeta = asRecord(explicitMeta);

  // The sentence, in order of how much the server meant it. Dialect 3's own `message` is
  // usually just the code echoed back — server copy never crosses
  // the boundary (ADR-045) — so prose the server deliberately authored under
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
    retryable: retryable === true,
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
    docUrl: typeof docsUrl === "string" ? docsUrl : typeof docUrl === "string" ? docUrl : undefined,
  };
};

/**
 * Statuses where nothing the caller can SEND will change the answer. A machine caller — Langy
 * runs the CLI in a shell — has exactly three moves after a failure: retry unchanged, retry
 * with different arguments, or stop.
 */
const TERMINAL_STATUSES = new Set([401, 402, 403, 404, 410]);

/**
 * True when retrying is pointless — see {@link TERMINAL_STATUSES}. Only ever said of a failure
 * the platform NAMED. An infrastructure failure is ours and transient by default, and a status
 * we read off a proxy's error page is not a verdict the platform reached.
 */
export const isTerminalFailure = (error: CliHandledError): boolean =>
  error.isHandled && TERMINAL_STATUSES.has(error.httpStatus);

/** A stable code for a failure the platform did not name itself. */
const codeForStatus = (status: number): string => {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= SERVER_ERROR_STATUS) return "internal_error";
  if (status > 0) return "request_failed";
  return "network_error";
};

const fallbackMessage = ({ status, body }: { status: number; body: unknown }): string => {
  if (typeof body === "string" && body.trim()) return body.trim().slice(0, 300);
  return status > 0 ? `Request failed with status ${status}` : "Request failed";
};

/**
 * Read an HTTP failure back into a {@link CliHandledError}. A body in the platform's error
 * shape that came back BELOW 500 is a true domain error and keeps its code.
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
      retryable: false,
    };
  }

  return {
    code: parsed.code,
    // Deprecated back-compat alias — see CliHandledError.kind.
    kind: parsed.code,
    message: parsed.message ?? parsed.code,
    httpStatus: status,
    meta: parsed.meta,
    retryable: parsed.retryable,
    ...(parsed.traceId ? { traceId: parsed.traceId } : {}),
    ...(parsed.traceUrl ? { traceUrl: parsed.traceUrl } : {}),
    ...(parsed.logsUrl ? { logsUrl: parsed.logsUrl } : {}),
    ...(parsed.reasons ? { reasons: parsed.reasons } : {}),
    ...(parsed.suggestions ? { suggestions: parsed.suggestions } : {}),
    ...(parsed.docUrl ? { docUrl: parsed.docUrl } : {}),
    // The platform names its own failures; a 5xx names ours, whatever the body says. Trusting a
    // 500's "code" would let an infrastructure outage present itself to the user as though they
    // had done something wrong. With no status to go on, the code decides: the platform only
    // emits a generic code when it fell over, so anything more specific than that is a failure
    // it chose to name — which is exactly what a domain error is.
    isHandled: status > 0 ? status < SERVER_ERROR_STATUS : !isGenericCode(parsed.code),
  };
};

/**
 * The document the CLI prints on stdout when a command fails under `--format json`, and the one
 * the panel reads back.
 */
export interface CliErrorDocument {
  ok: false;
  error: CliHandledError & {
    /**
     * Whether retrying — with the same arguments or with different ones — can possibly change
     * the answer. See {@link isTerminalFailure}.
     */
    terminal: boolean;
  };
}

/** Build the `--format json` failure document. */
export const toCliErrorDocument = (error: CliHandledError): CliErrorDocument => ({
  ok: false,
  error: { ...error, terminal: isTerminalFailure(error) },
});

/**
 * Read a CLI failure document back, or null when the output is not one. Null-on-miss rather
 * than throw: stdout may hold a card, a human table, or nothing at all, and none of those is an
 * error document.
 */
export const readCliErrorDocument = (output: unknown): CliHandledError | null => {
  const document = typeof output === "string" ? safeParseJson(output) : asRecord(output);

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
    retryable: error.retryable === true,
    ...(typeof error.traceId === "string" ? { traceId: error.traceId } : {}),
    ...(typeof error.traceUrl === "string" ? { traceUrl: error.traceUrl } : {}),
    ...(typeof error.logsUrl === "string" ? { logsUrl: error.logsUrl } : {}),
    ...(asReasons(error.reasons) ? { reasons: asReasons(error.reasons) } : {}),
    ...(asSuggestions(error.suggestions) ? { suggestions: asSuggestions(error.suggestions) } : {}),
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
    retryable: outer.retryable === true,
    ...(typeof outer.traceId === "string" ? { traceId: outer.traceId } : {}),
    ...(typeof outer.traceUrl === "string" ? { traceUrl: outer.traceUrl } : {}),
    ...(typeof outer.logsUrl === "string" ? { logsUrl: outer.logsUrl } : {}),
    ...(asReasons(outer.reasons) ? { reasons: asReasons(outer.reasons) } : {}),
    ...(asSuggestions(outer.suggestions) ? { suggestions: asSuggestions(outer.suggestions) } : {}),
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
 * The same reading, for an error that was THROWN rather than returned — the shape the SDK's
 * service layer raises.
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
    asRecord(outer?.originalError) ?? asRecord(outer?.cause) ?? asRecord(outer?.body) ?? outer;

  const status = statusOf(cause) || statusOf(outer);
  const parsed = parseHandledError({ status, body: cause });

  if (parsed.isHandled) return parsed;

  return {
    ...parsed,
    message: error instanceof Error && error.message ? error.message : parsed.message,
  };
};
