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
 *   errors (other status codes, fetch failures, timeouts) so logs read
 *   "user code raised: …" vs "NLP service returned 503";
 * - includes endpoint + status so multiple adapters in flight are
 *   distinguishable;
 * - strips known unrelated noise (AI SDK compat warnings, OTEL flush
 *   chatter) from the rendered detail; the raw payload is still attached
 *   to the thrown error for deep debugging;
 * - truncates long bodies at a clear marker rather than letting them blow
 *   out worker logs.
 */

const MAX_DETAIL_LENGTH = 2_000;

/** Lines we strip from the rendered surface (still preserved on the raw payload). */
const NOISE_PATTERNS: ReadonlyArray<RegExp> = [
  /^AI SDK Warning .*$/m,
  /^OTEL .*flushed.*$/m,
  /^Flushing OTEL traces\.\.\.$/m,
  /^\s*at v2 specification compatibility mode\..*$/m,
];

/** ANSI escape sequences from upstream Python loggers. */
const ANSI_ESCAPE = /\x1b\[[0-9;]*[A-Za-z]/g;

export interface AdapterErrorContext {
  endpoint: string;
  method: "POST";
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
 * Format a non-2xx response from the NLP service. HTTP 500 with a `detail`
 * is treated as user-code failure (langwatch_nlp re-raises Python errors via
 * HTTPException(status_code=500, detail=...)); other statuses are infra.
 */
export function formatHttpError(args: {
  ctx: AdapterErrorContext;
  status: number;
  rawBody: string;
  parsedDetail?: string;
}): string {
  const { ctx, status, rawBody, parsedDetail } = args;
  const isUserCodeError = status === 500 && Boolean(parsedDetail);
  const cleaned = cleanErrorDetail(parsedDetail ?? rawBody);

  if (isUserCodeError) {
    return [
      "SerializedCodeAgentAdapter: user code raised an error during execution.",
      `  endpoint: ${ctx.method} ${ctx.endpoint}`,
      `  status: ${status}`,
      "  user code error:",
      indent(cleaned, "    "),
    ].join("\n");
  }

  return [
    `SerializedCodeAgentAdapter: NLP service returned HTTP ${status}.`,
    `  endpoint: ${ctx.method} ${ctx.endpoint}`,
    `  body:`,
    indent(cleaned || "(empty)", "    "),
  ].join("\n");
}

/** Format a fetch-time failure (DNS, connect, abort/timeout). */
export function formatFetchError(args: {
  ctx: AdapterErrorContext;
  cause: unknown;
  timedOutAfterMs?: number;
}): string {
  const { ctx, cause, timedOutAfterMs } = args;
  if (typeof timedOutAfterMs === "number") {
    return [
      `SerializedCodeAgentAdapter: NLP service ${ctx.endpoint} did not respond within ${timedOutAfterMs}ms (request aborted).`,
      `  endpoint: ${ctx.method} ${ctx.endpoint}`,
    ].join("\n");
  }
  const causeMessage = cause instanceof Error ? cause.message : String(cause);
  const innerCause =
    cause instanceof Error && "cause" in cause && (cause as Error & { cause?: unknown }).cause
      ? `\n  cause: ${String((cause as Error & { cause?: unknown }).cause)}`
      : "";
  return [
    `SerializedCodeAgentAdapter: failed to reach NLP service.`,
    `  endpoint: ${ctx.method} ${ctx.endpoint}`,
    `  cause: ${causeMessage}${innerCause}`,
  ].join("\n");
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}
