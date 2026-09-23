/**
 * Formats NLP engine failures from SerializedCodeAgentAdapter: distinguishes user-code from infra,
 * omits endpoints, strips noise, caps length.
 */

import { goErrorEnvelopeSchema } from "./scenario-generate-nlpgo-error.rules.ts";

const MAX_DETAIL_LENGTH = 2_000;

/** Lines we strip from the rendered surface (still preserved on the raw payload). */
const NOISE_PATTERNS: readonly RegExp[] = [
  /^AI SDK Warning .*$/gm,
  /^OTEL .*flushed.*$/gm,
  /^Flushing OTEL traces\.\.\.$/gm,
  /^\s*at v2 specification compatibility mode\..*$/gm,
];

/**
 * ANSI escapes from upstream Python loggers, built from a char code because `no-control-regex`
 * refuses a literal escape. Without the escape byte, `[INFO]` would be stripped too.
 */
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");

/** Whether a failure originated in the user's code or the NLP service. */
export type HttpFailureSource = "user_code" | "nlp_service";

/**
 * The engine's structured error, as returned on a **200** whose run failed
 * (`WorkflowError` in `services/nlpgo/app/app.go:132`).
 */
export interface NlpEngineError {
  node_id?: string;
  type?: string;
  message?: string;
  traceback?: string;
}

/**
 * The engine's `WorkflowResult` (`services/nlpgo/app/app.go:121`) — the 2xx
 * body. `result` is omitted when the run failed.
 */
export interface NlpEngineResult {
  trace_id?: string;
  status?: string;
  result?: Record<string, unknown> | null;
  error?: NlpEngineError;
}

/**
 * Engine error types that are NOT customer Python: platform errors only, everything else is user
 * code (denylist not allowlist to catch unknowns).
 */
const PLATFORM_ENGINE_ERROR_TYPES: ReadonlySet<string> = new Set([
  "engine_error",
  "llm_executor_unavailable",
  "invalid_workflow",
  "context_canceled",
]);

/**
 * herr codes engine attributes to customer (not platform errors like bad key/id which adapter
 * supplies, not customer).
 */
const CUSTOMER_FAULT_HERR_CODES: ReadonlySet<string> = new Set([
  "bad_request",
  "invalid_dataset",
  "unsupported_node_kind",
  "code_block_timeout",
  "ssrf_blocked",
]);

/** The error detail parsed out of a non-2xx body, whatever shape it arrived in. */
export interface ParsedErrorEnvelope {
  /** herr code (`bad_request`) when the body was a herr envelope. */
  code?: string;
  /** Human-readable detail: herr `error.message`, or a legacy `detail`. */
  detail?: string;
  /** True when the body parsed as the legacy FastAPI `{ detail }` shape. */
  isLegacyDetail: boolean;
}

/** Coerce an unknown JSON value into a renderable string, or undefined. */
function asDetailString(value: unknown): string | undefined {
  if (typeof value === "string") return value.length > 0 ? value : undefined;
  if (value === undefined || value === null) return undefined;
  // FastAPI validation errors put an array here; a herr-ish body could put an
  // object. Stringify rather than letting a non-string reach `.replace()`.
  return JSON.stringify(value);
}

/**
 * Parse a non-2xx body into the fields the classifier needs. Accepts the
 * herr envelope (primary), the legacy FastAPI `{ detail }` shape (fallback),
 * and anything else (opaque — the raw text is rendered as-is).
 */
export function parseErrorEnvelope(rawBody: string): ParsedErrorEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { isLegacyDetail: false };
  }

  // The herr envelope is parsed with the SAME schema every other nlpgo reader
  // uses (`goHandledError.ts`), so a shape change lands in one place rather
  // than in a third hand-rolled parser.
  const herr = goErrorEnvelopeSchema.safeParse(parsed);
  if (herr.success) {
    return {
      code: herr.data.error.type,
      detail: asDetailString(herr.data.error.message),
      isLegacyDetail: false,
    };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { isLegacyDetail: false };
  }
  // Legacy FastAPI `{ detail }` — the only shape the shared schema does not
  // model, because nlpgo never emits it.
  const body = parsed as { detail?: unknown };
  if ("detail" in body) {
    return { detail: asDetailString(body.detail), isLegacyDetail: true };
  }
  return { isLegacyDetail: false };
}

/**
 * Classify 200 with failed run: anything not in PLATFORM_ENGINE_ERROR_TYPES is customer code.
 */
export function classifyEngineFailure(args: { errorType?: string }): HttpFailureSource {
  const type = args.errorType;
  if (type && PLATFORM_ENGINE_ERROR_TYPES.has(type)) return "nlp_service";
  return "user_code";
}

/**
 * Classify non-2xx response: herr code primary (fallback to legacy FastAPI 500 with detail).
 */
export function classifyHttpFailure(args: {
  status: number;
  envelope: ParsedErrorEnvelope;
}): HttpFailureSource {
  const { status, envelope } = args;
  if (envelope.code) {
    return CUSTOMER_FAULT_HERR_CODES.has(envelope.code) ? "user_code" : "nlp_service";
  }
  if (envelope.isLegacyDetail && status === 500 && Boolean(envelope.detail)) {
    return "user_code";
  }
  return "nlp_service";
}

/**
 * Strip noise patterns + ANSI escapes + collapse blank lines, then truncate.
 * The original payload is preserved on the thrown error for callers that
 * want the full blob.
 */
export function cleanErrorDetail(raw: string): string {
  let cleaned = raw.replace(ANSI_ESCAPE, "");
  cleaned = cleaned.replace(ENGINE_HARNESS_FRAME, "");
  for (const pattern of NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }
  // A stripped noise line leaves its newline behind, so collapse 2+ blank
  // lines (not 3+) or a two-line noise block leaves a gap mid-traceback.
  cleaned = cleaned.replace(/\n[ \t]*\n[ \t]*\n*/g, "\n\n").trim();
  if (cleaned.length > MAX_DETAIL_LENGTH) {
    // Report the length of what was actually withheld, not `raw.length` —
    // noise this function already deleted is not text anyone can go read.
    cleaned =
      cleaned.slice(0, MAX_DETAIL_LENGTH) +
      `\n... (truncated, original was ${cleaned.length} chars)`;
  }
  return cleaned;
}

/** The customer-facing rendering of a user-code failure. */
function renderUserCodeFailure(args: { statusLine: string; detail: string }): string {
  return [
    "SerializedCodeAgentAdapter: user code raised an error during execution.",
    `  ${args.statusLine}`,
    "  user code error:",
    indent(args.detail, "    "),
  ].join("\n");
}

/**
 * NLP-service failure rendering: redacts detail (infra names host:port), but not user-code detail
 * (customer's traceback).
 */
function renderServiceFailure(args: { headline: string; detail: string }): string {
  return [
    args.headline,
    `  body:`,
    indent(redactInternalAddresses(args.detail) || "(empty)", "    "),
  ].join("\n");
}

/**
 * Format 200 with failed run (customer's Python exception): returns message, source, and rawDetail;
 * prefers traceback over one-line message.
 */
export function formatEngineError(args: { engineError: NlpEngineError | undefined }): {
  message: string;
  source: HttpFailureSource;
  rawDetail: string;
} {
  const { engineError } = args;
  // `status: "error"` with no `error` object is the engine breaking its own
  // 200-failure contract, not a customer's Python raising nothing. Defaulting
  // it to `{}` would blame the customer for a message that is entirely ours.
  if (!engineError) {
    return {
      source: "nlp_service",
      rawDetail: "",
      message: renderServiceFailure({
        headline:
          "SerializedCodeAgentAdapter: NLP service reported a failed run without an error body.",
        detail: "",
      }),
    };
  }
  const source = classifyEngineFailure({ errorType: engineError.type });
  const rawDetail = engineError.traceback ?? engineError.message ?? engineError.type ?? "";
  const cleaned = cleanErrorDetail(rawDetail);
  const label = engineError.type ? `type: ${engineError.type}` : "type: unknown";

  if (source === "user_code") {
    return {
      source,
      rawDetail,
      message: renderUserCodeFailure({ statusLine: label, detail: cleaned }),
    };
  }
  return {
    source,
    rawDetail,
    message: renderServiceFailure({
      headline: "SerializedCodeAgentAdapter: NLP service failed while running the workflow.",
      detail: cleaned,
    }),
  };
}

/**
 * Format non-2xx NLP response: parses raw body, omits internal endpoint from message, returns
 * customer-facing message and classification source.
 */
export function formatHttpError(args: { status: number; rawBody: string }): {
  message: string;
  source: HttpFailureSource;
  rawDetail: string;
} {
  const { status, rawBody } = args;
  const envelope = parseErrorEnvelope(rawBody);
  const source = classifyHttpFailure({ status, envelope });
  const rawDetail = envelope.detail ?? rawBody;
  const cleaned = cleanErrorDetail(rawDetail);

  if (source === "user_code") {
    return {
      source,
      rawDetail,
      message: renderUserCodeFailure({
        statusLine: `status: ${status}`,
        detail: cleaned,
      }),
    };
  }

  return {
    source,
    rawDetail,
    message: renderServiceFailure({
      headline: `SerializedCodeAgentAdapter: NLP service returned HTTP ${status}.`,
      detail: cleaned,
    }),
  };
}

/**
 * Format 2xx with non-JSON body (proxy/portal): shares renderServiceFailure with non-2xx path to
 * keep wording consistent.
 */
export function formatMalformedBodyError(args: { status: number; rawBody: string }): {
  message: string;
  source: HttpFailureSource;
  rawDetail: string;
} {
  return {
    source: "nlp_service",
    rawDetail: args.rawBody,
    message: renderServiceFailure({
      headline: `SerializedCodeAgentAdapter: NLP service returned HTTP ${args.status} with a body that is not valid JSON.`,
      detail: cleanErrorDetail(args.rawBody),
    }),
  };
}

/** IPv4 (and bracketed IPv6) addresses, with or without a port. */
const IP_ADDRESS = /\[[0-9a-fA-F:]+\](?::\d{1,5})?|\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/g;
/**
 * `token:port` pair (e.g., `nlp-internal:5561`): deliberate single quantifier to avoid redos on
 * `--` runs; host vs code location decided in code.
 */
const TOKEN_WITH_PORT = /\b[A-Za-z0-9][A-Za-z0-9._-]*:\d{2,5}\b(?![.:\d])/g;

/**
 * Source-file suffixes: distinguish code location from address; don't redact customer's own
 * debugging info like `script.py:42`.
 */
const SOURCE_FILE_SUFFIX =
  /\.(py|pyc|ts|tsx|js|jsx|mjs|cjs|go|rb|java|kt|c|cc|cpp|h|hpp|rs|sh|sql|json|ya?ml|toml|txt|log)$/i;

/** True when a `token:port` match names a host rather than a code location. */
function looksLikeHostPort(match: string): boolean {
  const host = match.slice(0, match.lastIndexOf(":"));
  if (!/[.-]/.test(host)) return false; // bare word: `code:127`
  if (/^[\d.]+$/.test(host)) return false; // handled by IP_ADDRESS
  return !SOURCE_FILE_SUFFIX.test(host);
}
/** Absolute URLs. */
const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;
/**
 * Engine's execution-harness frames (internal path, pure noise): engine anonymizes customer's frame
 * to `<code-block>`, wrapper frames stay.
 */
const ENGINE_HARNESS_FRAME =
  /^[ \t]*File "\/tmp\/nlpgo-codeblock-[^"]*",.*$\n?(?:^[ \t]{4,}[^ \t\n].*$\n?|^[ \t]*\^+[ \t]*$\n?)*/gm;

/**
 * Remove anything identifying the internal NLP service before it reaches a
 * customer. undici's `fetch failed` carries a `cause` with the host:port,
 * which would otherwise land in the persisted run record.
 */
export function redactInternalAddresses(text: string): string {
  return text
    .replace(URL_PATTERN, "[redacted]")
    .replace(IP_ADDRESS, "[redacted]")
    .replace(TOKEN_WITH_PORT, (match) => (looksLikeHostPort(match) ? "[redacted]" : match));
}

/**
 * Replace known secrets literally (not pattern): defence-in-depth for echoed credentials; skip
 * short values to avoid corrupting ordinary text.
 */
export function scrubKnownSecrets(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (typeof secret !== "string" || secret.length < 8) continue;
    out = out.split(secret).join("[redacted]");
  }
  return out;
}

/**
 * Format fetch-time failure (DNS/connect/abort/timeout): omits internal endpoint from message,
 * keeps only actionable code/errno.
 */
export function formatFetchError(args: { cause: unknown; timedOutAfterMs?: number }): string {
  const { cause, timedOutAfterMs } = args;
  if (typeof timedOutAfterMs === "number") {
    return `SerializedCodeAgentAdapter: NLP service did not respond within ${timedOutAfterMs}ms (request aborted).`;
  }
  const causeMessage = redactInternalAddresses(
    cause instanceof Error ? cause.message : String(cause),
  );
  const innerCause = describeInnerCause(cause);
  return [
    `SerializedCodeAgentAdapter: failed to reach NLP service.`,
    `  cause: ${causeMessage}${innerCause}`,
  ].join("\n");
}

/**
 * Render the nested `cause` undici attaches, preferring its `code`
 * (`ECONNREFUSED`, `ENOTFOUND`) — all a customer can act on, and free of the
 * address the full message carries.
 */
function describeInnerCause(cause: unknown): string {
  if (!(cause instanceof Error) || !("cause" in cause)) return "";
  const inner = (cause as Error & { cause?: unknown }).cause;
  // Falsy covers null/undefined, so the later `in` check needs no null guard.
  if (!inner) return "";
  const code =
    typeof inner === "object" && "code" in inner ? (inner as { code?: unknown }).code : undefined;
  if (typeof code === "string" && code.length > 0) {
    return `\n  cause: ${code}`;
  }
  return `\n  cause: ${redactInternalAddresses(String(inner))}`;
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}
