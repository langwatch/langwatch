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

/** A run that the engine finalized as failed. */
export interface NlpEngineResult {
  status?: string;
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
 * Deliberate divergence from that Go function: it also counts `unauthorized`
 * and `not_found` as customer faults, but on this path both describe the
 * *adapter's own* request envelope — the adapter supplies the API key and the
 * synthetic workflow id, the customer never sees them. Blaming user code for
 * a bad platform credential is the same mislabelling in the other direction,
 * so those two stay infra here.
 */
const CUSTOMER_FAULT_HERR_CODES: ReadonlySet<string> = new Set([
  "bad_request",
  "invalid_workflow",
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
  if (typeof parsed !== "object" || parsed === null) {
    return { legacyDetail: false };
  }

  const body = parsed as { error?: unknown; detail?: unknown };

  if (typeof body.error === "object" && body.error !== null) {
    const herr = body.error as { type?: unknown; message?: unknown };
    return {
      code: typeof herr.type === "string" ? herr.type : undefined,
      detail: asDetailString(herr.message),
      legacyDetail: false,
    };
  }

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
  for (const pattern of NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }
  // A stripped noise line leaves its newline behind, so collapse 2+ blank
  // lines (not 3+) or a two-line noise block leaves a gap mid-traceback.
  cleaned = cleaned.replace(/\n[ \t]*\n[ \t]*\n*/g, "\n\n").trim();
  if (cleaned.length > MAX_DETAIL_LENGTH) {
    cleaned =
      cleaned.slice(0, MAX_DETAIL_LENGTH) +
      `\n... (truncated, original was ${raw.length} chars)`;
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

/** The customer-facing rendering of an NLP-service failure. */
function renderServiceFailure(args: {
  headline: string;
  detail: string;
}): string {
  return [
    args.headline,
    `  body:`,
    indent(args.detail || "(empty)", "    "),
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

/** IPv4 (and bracketed IPv6) host:port pairs, e.g. `10.4.2.11:5561`. */
const ADDRESS_WITH_PORT =
  /\[[0-9a-fA-F:]+\]:\d+|\b\d{1,3}(?:\.\d{1,3}){3}:\d+\b/g;
/** Bare hostnames carrying a port, e.g. `nlp-internal:5561`. */
const HOST_WITH_PORT = /\b[A-Za-z0-9][A-Za-z0-9._-]*:\d{2,5}\b/g;
/** Absolute URLs. */
const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;

/**
 * Remove anything that identifies the internal NLP service from a string that
 * will be shown to a customer. undici's `fetch failed` carries a `cause` of
 * `connect ECONNREFUSED 10.4.2.11:5561`, so without this the host:port the
 * module promises to withhold lands in the persisted run record.
 */
export function redactInternalAddresses(text: string): string {
  return text
    .replace(URL_PATTERN, "[redacted]")
    .replace(ADDRESS_WITH_PORT, "[redacted]")
    .replace(HOST_WITH_PORT, "[redacted]");
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
