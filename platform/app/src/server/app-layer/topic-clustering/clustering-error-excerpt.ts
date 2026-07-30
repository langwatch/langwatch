/**
 * Bounding and sanitising the upstream detail a clustering failure carries.
 *
 * A clustering failure message is not just read by an operator: it is written
 * to the event log by `recordClusteringRunFailed`, so whatever it quotes
 * becomes DURABLE STATE with the retention of the run, not of a log line.
 *
 * Two things follow, and both used to be missing.
 *
 * 1. THE BOUND HAS TO BE IN BYTES. The excerpt was cut at the first 10 lines
 *    of pretty-printed JSON, which bounds nothing — one long line passes
 *    whole, and a request body is a plausible way to produce one.
 *
 * 2. THE ECHO HAS TO GO. The request we send carries the traces' own text
 *    (`traces: [{ input: … }]`), and a pydantic 422 replies by quoting the
 *    value it rejected back at us under `input`. Keeping that would copy the
 *    customer's trace content into our event log to explain a validation
 *    error, which is never the trade worth making — the field name and the
 *    error type say what is wrong without it.
 *
 * Pure and dependency-free so the failure path can use it without dragging in
 * the clustering module.
 */

/**
 * How much upstream detail survives into a failure message. Generous enough
 * for a validation error's structure, small enough that no single failure can
 * write a payload-sized row.
 */
export const CLUSTERING_ERROR_EXCERPT_MAX_BYTES = 2048;

/**
 * How much of a whole failure message survives into the log and the event.
 * Larger than the excerpt because the message wraps it in our own prose.
 */
export const CLUSTERING_ERROR_MESSAGE_MAX_BYTES = 4096;

/** Keys whose values are the request echoed back, never diagnostic on their own. */
const ECHOED_REQUEST_KEYS = new Set(["input"]);

const REDACTED = "[redacted]";

/**
 * Cut `text` to at most `maxBytes` UTF-8 bytes.
 *
 * Slicing a UTF-8 buffer can land mid-codepoint, which decodes to U+FFFD; the
 * trailing replacement characters are dropped rather than emitted, so the
 * excerpt never ends in mojibake.
 */
export function truncateToBytes({
  text,
  maxBytes,
}: {
  text: string;
  maxBytes: number;
}): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  const decoded = Buffer.from(text, "utf8")
    .subarray(0, maxBytes)
    .toString("utf8")
    .replace(/\uFFFD+$/, "");
  return `${decoded}… [truncated]`;
}

/** Replace every `input` value at any depth, leaving the structure readable. */
function stripEchoedRequest(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripEchoedRequest);
  if (value !== null && typeof value === "object") {
    const stripped: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>,
    )) {
      stripped[key] = ECHOED_REQUEST_KEYS.has(key)
        ? REDACTED
        : stripEchoedRequest(nested);
    }
    return stripped;
  }
  return value;
}

/**
 * Turn an upstream error body into the excerpt a failure message may quote:
 * request echoes removed, and bounded in bytes whether or not it parsed.
 */
export function clusteringErrorExcerpt(body: string): string {
  let text = body;
  try {
    text = JSON.stringify(stripEchoedRequest(JSON.parse(body)), null, 2);
  } catch {
    // Not JSON, so there is no `input` field to find. The byte bound below is
    // the only protection left, which is exactly why it is unconditional.
  }
  return truncateToBytes({
    text,
    maxBytes: CLUSTERING_ERROR_EXCERPT_MAX_BYTES,
  });
}

/**
 * Bound a whole failure message before it is logged or recorded.
 *
 * Belt to {@link clusteringErrorExcerpt}'s braces: not every clustering
 * failure comes from the langevals response path, and the event log must not
 * inherit the size of an error we did not construct.
 */
export function boundClusteringErrorMessage(message: string): string {
  return truncateToBytes({
    text: message,
    maxBytes: CLUSTERING_ERROR_MESSAGE_MAX_BYTES,
  });
}
