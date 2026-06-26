/**
 * Formats failures originating in the SerializedCodeAgentAdapter NLP request.
 *
 * Tracks lw#3439. The previous "[SerializedCodeAgentAdapter] Error: Code
 * execution failed: HTTP 500 - <raw blob>" string interleaved AI SDK warnings
 * and OTEL flush notices with the actual user-code traceback, making customer
 * debugging require stderr archaeology.
 *
 * The formatter:
 * - distinguishes user-code errors (HTTP 500 with `detail`) from infra
 *   errors (other status codes, fetch failures, timeouts) so the surfaced
 *   message reads "user code raised: …" vs "NLP service returned 503". The
 *   classification is computed in exactly one place (`classifyHttpFailure`)
 *   and `formatHttpError` returns the derived `source` alongside the
 *   message so the adapter's structured `source` field can never drift from
 *   the wording the customer sees;
 * - deliberately omits the internal NLP endpoint host:port from the
 *   rendered message — this string is persisted onto the user-visible
 *   scenario-run record, so the endpoint lives only on the structured
 *   `.endpoint` field (programmatic) and server logs, never the customer
 *   message;
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

/** Whether an HTTP failure originated in the user's code or the NLP service. */
export type HttpFailureSource = "user_code" | "nlp_service";

/**
 * Single source of truth for the user-code-vs-infra classification.
 *
 * langwatch_nlp re-raises Python errors via HTTPException(status_code=500,
 * detail=…), so an HTTP 500 carrying a parsed `detail` is a user-code
 * failure; everything else (other statuses, or a 500 with an opaque body)
 * is treated as an NLP-service/infra failure. Both the rendered message
 * wording and the adapter's structured `source` field derive from this one
 * predicate, so they cannot disagree.
 */
export function classifyHttpFailure(args: {
  status: number;
  parsedDetail?: string;
}): HttpFailureSource {
  return args.status === 500 && Boolean(args.parsedDetail)
    ? "user_code"
    : "nlp_service";
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
  // Collapse 3+ blank lines into a single paragraph break.
  cleaned = cleaned.replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
  if (cleaned.length > MAX_DETAIL_LENGTH) {
    cleaned =
      cleaned.slice(0, MAX_DETAIL_LENGTH) +
      `\n... (truncated, original was ${raw.length} chars; full body on error.rawDetail)`;
  }
  return cleaned;
}

/**
 * Format a non-2xx response from the NLP service.
 *
 * Returns both the customer-facing `message` and the `source` it derived, so
 * the adapter sets its structured `source` field from the exact same
 * classification that chose the wording (see `classifyHttpFailure`). The
 * internal endpoint is intentionally absent from the message.
 */
export function formatHttpError(args: {
  status: number;
  rawBody: string;
  parsedDetail?: string;
}): { message: string; source: HttpFailureSource } {
  const { status, rawBody, parsedDetail } = args;
  const source = classifyHttpFailure({ status, parsedDetail });
  const cleaned = cleanErrorDetail(parsedDetail ?? rawBody);

  if (source === "user_code") {
    return {
      source,
      message: [
        "SerializedCodeAgentAdapter: user code raised an error during execution.",
        `  status: ${status}`,
        "  user code error:",
        indent(cleaned, "    "),
      ].join("\n"),
    };
  }

  return {
    source,
    message: [
      `SerializedCodeAgentAdapter: NLP service returned HTTP ${status}.`,
      `  body:`,
      indent(cleaned || "(empty)", "    "),
    ].join("\n"),
  };
}

/**
 * Format a fetch-time failure (DNS, connect, abort/timeout).
 *
 * The internal endpoint is intentionally absent from the message; it lives
 * on the thrown error's structured `.endpoint` field instead.
 */
export function formatFetchError(args: {
  cause: unknown;
  timedOutAfterMs?: number;
}): string {
  const { cause, timedOutAfterMs } = args;
  if (typeof timedOutAfterMs === "number") {
    return `SerializedCodeAgentAdapter: NLP service did not respond within ${timedOutAfterMs}ms (request aborted).`;
  }
  const causeMessage = cause instanceof Error ? cause.message : String(cause);
  const innerCause =
    cause instanceof Error &&
    "cause" in cause &&
    (cause as Error & { cause?: unknown }).cause
      ? `\n  cause: ${String((cause as Error & { cause?: unknown }).cause)}`
      : "";
  return [
    `SerializedCodeAgentAdapter: failed to reach NLP service.`,
    `  cause: ${causeMessage}${innerCause}`,
  ].join("\n");
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}
