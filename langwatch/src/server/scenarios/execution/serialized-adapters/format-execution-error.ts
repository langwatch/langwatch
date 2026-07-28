/**
 * Formats failures originating in the SerializedCodeAgentAdapter NLP request.
 *
 * Tracks lw#3439. The previous "[SerializedCodeAgentAdapter] Error: Code
 * execution failed: HTTP 500 - <raw blob>" string interleaved AI SDK warnings
 * and OTEL flush notices with the actual user-code traceback, making customer
 * debugging require stderr archaeology.
 *
 * ## The contract this formats against
 *
 * The adapter dials `/go/studio/execute_sync`, served by the Go NLP engine
 * (`services/nlpgo`). That engine reports failures in two distinct shapes, and
 * the user-code one does NOT come back as a non-2xx:
 *
 * 1. **A node failed while running the workflow — HTTP 200.** The engine
 *    finalizes the run as `{ trace_id, status: "error", error: { node_id,
 *    type, message, traceback } }` with `result` omitted
 *    (`services/nlpgo/app/engine/engine.go` `finalize`, shape at
 *    `services/nlpgo/app/app.go:121-137`). For this adapter the workflow is
 *    always entry -> one code node -> end, so a node failure here is the
 *    customer's Python: `type` carries the exception class
 *    (`AttributeError`, `SyntaxError`, …) — see the engine's own integration
 *    tests in `services/nlpgo/tests/integration/code_block_spec_test.go`,
 *    which assert HTTP 200 for exactly these cases.
 * 2. **The request envelope failed — non-2xx.** `writeHandlerError` emits the
 *    herr envelope `{ error: { type, message, meta, trace_id } }`
 *    (`pkg/herr/http.go:30-74`), with the status registered in
 *    `services/nlpgo/adapters/httpapi/router.go` `registerErrorStatuses`.
 *
 * There is no FastAPI `{ detail: … }` on this path — `grep '"detail"'
 * services/nlpgo --include='*.go'` returns nothing and no Python
 * `execute_sync` remains. The legacy `detail` shape is still parsed as a
 * fallback for any deployment that still fronts the endpoint with FastAPI,
 * but it is not the primary contract.
 *
 * ## What the formatter guarantees
 *
 * - distinguishes user-code failures from infra failures so the surfaced
 *   message reads "user code raised: …" vs "NLP service returned HTTP 503".
 *   The classification is computed in exactly one place per shape
 *   (`classifyEngineFailure` / `classifyHttpFailure`) and the format
 *   functions return the derived `source` alongside the message, so the
 *   adapter's structured `source` field can never drift from the wording the
 *   customer sees;
 * - deliberately omits the internal NLP endpoint host:port from every
 *   rendered message — including the fetch-failure path, where undici puts
 *   the address in the error `cause`. This string is persisted onto the
 *   user-visible scenario-run record, so the endpoint lives only on the
 *   structured `.endpoint` field (programmatic) and server logs;
 * - strips known unrelated noise (AI SDK compat warnings, OTEL flush
 *   chatter) from the rendered detail; the raw payload is still attached
 *   to the thrown error for deep debugging;
 * - truncates long bodies at a clear marker rather than letting them blow
 *   out worker logs.
 */

import { goErrorEnvelopeSchema } from "../../../nlpgo/goHandledError";

const MAX_DETAIL_LENGTH = 2_000;

/** Lines we strip from the rendered surface (still preserved on the raw payload). */
const NOISE_PATTERNS: ReadonlyArray<RegExp> = [
  /^AI SDK Warning .*$/gm,
  /^OTEL .*flushed.*$/gm,
  /^Flushing OTEL traces\.\.\.$/gm,
  /^\s*at v2 specification compatibility mode\..*$/gm,
];

/** ANSI escape sequences from upstream Python loggers. */
const ANSI_ESCAPE = /\x1b\[[0-9;]*[A-Za-z]/g;

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
 * Engine error types that are NOT the customer's Python, even though they
 * arrive on the same 200-with-`status:"error"` path.
 *
 * `engine_error` / `llm_executor_unavailable` are `classifyNodeFault`'s
 * platform bucket in `services/nlpgo/app/engine/faults.go`. The other two are
 * this adapter's own responsibility rather than the engine's taxonomy:
 * `invalid_workflow` means the DSL failed to parse, and **this adapter
 * synthesizes that DSL** (entry -> code -> end) from the agent config — the
 * customer never writes it; `context_canceled` is `finalize`'s response to a
 * cancelled request, which is our timeout, not their bug.
 *
 * Both were observed arriving as HTTP 200 from a live engine while recording
 * `__tests__/fixtures/nlpgo-recorded-responses.json` — neither was reachable
 * through the hand-written mocks this PR replaced.
 *
 * This adapter submits a workflow of exactly one code node, so **every other**
 * node failure is the customer's Python (the type is then the raised
 * exception class — `TimeoutException`, `SyntaxError`, `KeyError`, all
 * observed live). Denylisting rather than allowlisting exception classes is
 * what keeps an unseen Python exception classified as user code instead of
 * silently inverting to infra — the exact failure lw#3439 is about.
 */
const PLATFORM_ENGINE_ERROR_TYPES: ReadonlySet<string> = new Set([
  "engine_error",
  "llm_executor_unavailable",
  "invalid_workflow",
  "context_canceled",
]);

/**
 * herr codes the NLP engine attributes to the customer, mirroring
 * `handlerFault` in `services/nlpgo/adapters/httpapi/handler_errors.go`.
 *
 * Deliberate divergence from that Go function: it also counts `unauthorized`,
 * `not_found` and `invalid_workflow` as customer faults, but on this path all
 * three describe the *adapter's own* request envelope — the adapter supplies
 * the API key and the synthetic workflow id, and it synthesizes the DSL, so
 * the customer authors none of them. Blaming user code for a bad platform
 * credential is the same mislabelling in the other direction, so all three
 * stay infra here.
 *
 * `invalid_workflow` in particular MUST agree with its entry in
 * `PLATFORM_ENGINE_ERROR_TYPES` above: the engine can report the same root
 * cause on either transport, and the same cause must not get opposite blame
 * depending on which one it took.
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
  legacyDetail: boolean;
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
 * Parse a non-2xx body into the fields the classifier needs.
 *
 * Accepts the herr envelope (primary), the legacy FastAPI `{ detail }` shape
 * (fallback), and anything else (opaque — the raw text is rendered as-is).
 */
export function parseErrorEnvelope(rawBody: string): ParsedErrorEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { legacyDetail: false };
  }

  // The herr envelope is parsed with the SAME schema every other nlpgo reader
  // uses (`goHandledError.ts`), so a shape change lands in one place rather
  // than in a third hand-rolled parser.
  const herr = goErrorEnvelopeSchema.safeParse(parsed);
  if (herr.success) {
    return {
      code: herr.data.error.type,
      detail: asDetailString(herr.data.error.message),
      legacyDetail: false,
    };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { legacyDetail: false };
  }
  // Legacy FastAPI `{ detail }` — the only shape the shared schema does not
  // model, because nlpgo never emits it.
  const body = parsed as { detail?: unknown };
  if ("detail" in body) {
    return { detail: asDetailString(body.detail), legacyDetail: true };
  }
  return { legacyDetail: false };
}

/**
 * Classify a **200** whose run the engine finalized as failed.
 *
 * Anything the engine does not attribute to itself is the customer's code —
 * see `PLATFORM_ENGINE_ERROR_TYPES`.
 */
export function classifyEngineFailure(args: {
  errorType?: string;
}): HttpFailureSource {
  const type = args.errorType;
  if (type && PLATFORM_ENGINE_ERROR_TYPES.has(type)) return "nlp_service";
  return "user_code";
}

/**
 * Classify a non-2xx response.
 *
 * Primary predicate is the herr code, mirroring the engine's own customer /
 * platform split (`CUSTOMER_FAULT_HERR_CODES`). The legacy FastAPI shape —
 * an HTTP 500 carrying a `detail` — is honoured as a fallback so a
 * FastAPI-fronted deployment still classifies correctly.
 */
export function classifyHttpFailure(args: {
  status: number;
  envelope: ParsedErrorEnvelope;
}): HttpFailureSource {
  const { status, envelope } = args;
  if (envelope.code) {
    return CUSTOMER_FAULT_HERR_CODES.has(envelope.code)
      ? "user_code"
      : "nlp_service";
  }
  if (envelope.legacyDetail && status === 500 && Boolean(envelope.detail)) {
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
function renderUserCodeFailure(args: {
  statusLine: string;
  detail: string;
}): string {
  return [
    "SerializedCodeAgentAdapter: user code raised an error during execution.",
    `  ${args.statusLine}`,
    "  user code error:",
    indent(args.detail, "    "),
  ].join("\n");
}

/**
 * The customer-facing rendering of an NLP-service failure.
 *
 * The detail is redacted here and NOT in `renderUserCodeFailure`, and the
 * split is deliberate. An infra body is written by our own stack — an nginx
 * 502 page, an Envoy `upstream connect error`, a herr `child_unavailable`
 * message — and routinely names the upstream `host:port` this module promises
 * to withhold from the persisted run record. A user-code detail is the
 * customer's own traceback, which may legitimately contain a URL *they* wrote;
 * redacting that would hide their bug from them.
 */
function renderServiceFailure(args: {
  headline: string;
  detail: string;
}): string {
  return [
    args.headline,
    `  body:`,
    indent(redactInternalAddresses(args.detail) || "(empty)", "    "),
  ].join("\n");
}

/**
 * Format a **200** whose run the engine finalized as failed — the shape a
 * user's Python exception actually arrives in.
 *
 * Returns the customer-facing `message`, the `source` it derived, and the
 * `rawDetail` the adapter attaches for deep debugging. The engine's traceback
 * is preferred over its one-line message because it is what a customer
 * debugs from.
 */
export function formatEngineError(args: { engineError: NlpEngineError }): {
  message: string;
  source: HttpFailureSource;
  rawDetail: string;
} {
  const { engineError } = args;
  const source = classifyEngineFailure({ errorType: engineError.type });
  const rawDetail =
    engineError.traceback ?? engineError.message ?? engineError.type ?? "";
  const cleaned = cleanErrorDetail(rawDetail);
  const label = engineError.type
    ? `type: ${engineError.type}`
    : "type: unknown";

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
      headline:
        "SerializedCodeAgentAdapter: NLP service failed while running the workflow.",
      detail: cleaned,
    }),
  };
}

/**
 * Format a non-2xx response from the NLP service.
 *
 * Takes the body as raw text and does its own parsing, so the caller never
 * has to assert a shape onto it (an unchecked cast here previously let a
 * non-string `detail` crash the formatter). Returns both the customer-facing
 * `message` and the `source` it derived, so the adapter sets its structured
 * `source` field from the exact same classification that chose the wording.
 * The internal endpoint is intentionally absent from the message.
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
 * Format a 2xx whose body is not the JSON the engine promises — something is
 * answering on the NLP service's behalf (a proxy, a captive portal).
 *
 * Shares `renderServiceFailure` with the non-2xx path so the two cannot drift
 * in wording, truncation limit, noise-stripping or redaction.
 */
export function formatMalformedBodyError(args: {
  status: number;
  rawBody: string;
}): { message: string; source: HttpFailureSource; rawDetail: string } {
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
const IP_ADDRESS =
  /\[[0-9a-fA-F:]+\](?::\d{1,5})?|\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/g;
/**
 * A `token:port` pair — the candidate shape for `nlp-internal:5561`.
 *
 * Deliberately ONE unnested quantifier. The obvious "host is labels joined by
 * separators" form — `[A-Za-z0-9_-]*(?:[.-][A-Za-z0-9_-]+)+` — lets a `-` be
 * consumed by either side, which is exponential backtracking on a run of
 * `--` (CodeQL `js/redos`, high). This function runs over error bodies
 * written by upstreams we do not control, so that is reachable. Whether a
 * match is really a host is decided in code below, not by the pattern.
 */
const TOKEN_WITH_PORT = /\b[A-Za-z0-9][A-Za-z0-9._-]*:\d{2,5}\b(?![.:\d])/g;

/**
 * Source-file suffixes that make a `token:port` a code location rather than
 * an address. `File "script.py:42"` is the single most common shape in a
 * Python traceback, and this function now runs over rendered infra detail —
 * redacting it would corrupt the customer's own debugging information.
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
 * The engine's own execution-harness frames, e.g.
 * `File "/tmp/nlpgo-codeblock-369240540/runner.py", line 143, in main`.
 *
 * The engine already anonymizes the customer's own frame to `<code-block>`,
 * but its wrapper frames ride along in the same traceback. They are both an
 * internal server path and pure noise to the customer — the frames they can
 * act on are their own.
 */
const ENGINE_HARNESS_FRAME =
  /^[ \t]*File "\/tmp\/nlpgo-codeblock-[^"]*",.*$\n?(?:^[ \t]{4,}[^ \t\n].*$\n?|^[ \t]*\^+[ \t]*$\n?)*/gm;

/**
 * Remove anything that identifies the internal NLP service from a string that
 * will be shown to a customer. undici's `fetch failed` carries a `cause` of
 * `connect ECONNREFUSED 10.4.2.11:5561`, so without this the host:port the
 * module promises to withhold lands in the persisted run record.
 */
export function redactInternalAddresses(text: string): string {
  return text
    .replace(URL_PATTERN, "[redacted]")
    .replace(IP_ADDRESS, "[redacted]")
    .replace(TOKEN_WITH_PORT, (match) =>
      looksLikeHostPort(match) ? "[redacted]" : match,
    );
}

/**
 * Replace known secret values with a marker, literally.
 *
 * Defence-in-depth, independent of what the engine puts in its error text.
 * The adapter puts a live provider credential (`workflow.api_key`) and the
 * project's secrets into the outgoing request, and this error text is
 * persisted onto a customer-visible run record. If any upstream ever echoes a
 * rejected credential, or a validation error quotes the submitted value back,
 * pattern-based redaction would not catch it — only knowing the actual values
 * does.
 *
 * Short values are skipped: a one- or two-character "secret" would rewrite
 * ordinary text and destroy the message.
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
 * Format a fetch-time failure (DNS, connect, abort/timeout).
 *
 * The internal endpoint is intentionally absent from the message; it lives
 * on the thrown error's structured `.endpoint` field instead. The cause is
 * reduced to its `code`/`errno` where the platform provides one — that is
 * the actionable part — and otherwise redacted.
 */
export function formatFetchError(args: {
  cause: unknown;
  timedOutAfterMs?: number;
}): string {
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
    typeof inner === "object" && "code" in inner
      ? (inner as { code?: unknown }).code
      : undefined;
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
