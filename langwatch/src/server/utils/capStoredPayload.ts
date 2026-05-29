/**
 * capStoredPayload — bounds the byte-size of large text/JSON values before they
 * are written into the hot ClickHouse path (evaluation_runs.Inputs and the
 * trace-summary computedInput/Output).
 *
 * Why this exists
 * ---------------
 * A few heavy-agentic tenants run evaluators over the entire growing
 * conversation, so a single evaluator-input row can reach multiple megabytes.
 * ClickHouse merges materialize whole granules, so one multi-MB row makes a
 * granule larger than 2GB and a background merge can exceed the server memory
 * cap, OOM, and stall merges cluster-wide — which is what tipped a production
 * part-storm. Normal inputs are a couple KB; only the pathological tail is a
 * problem, so we cap by size at the write site.
 *
 * Two shapes, two helpers
 * -----------------------
 * - `capStoredJson` is for columns persisted as serialized JSON and JSON-parsed
 *   on read (evaluation_runs.Inputs). A mid-string truncation would break
 *   `JSON.parse`, so an oversized value is replaced with a small, still-valid
 *   JSON placeholder that carries the original size and a preview.
 * - `capStoredText` is for columns stored and rendered as free text
 *   (trace-summary computedInput/Output). An oversized value is truncated on a
 *   UTF-8 boundary with a human-readable marker appended.
 *
 * Both are allocation-light, never throw, and leave normal-sized values
 * byte-for-byte unchanged.
 */

const KB = 1024;

/**
 * Generous default cap (32KB). Normal evaluator inputs and trace IO are a few
 * KB; this only trips on the multi-MB tail from agentic full-conversation
 * payloads. Override per call site / via env if a tighter bound is needed.
 */
export const DEFAULT_MAX_STORED_PAYLOAD_BYTES = 32 * KB;

/** Bytes of the original kept as a debugging preview inside a JSON placeholder. */
const JSON_PREVIEW_BYTES = 2 * KB;

/** UTF-8 byte length of a string, without allocating a Buffer copy. */
export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/**
 * Truncates a string to at most `maxBytes` UTF-8 bytes. A trailing multibyte
 * sequence cut by the slice decodes to the replacement char, which is fine for
 * a preview / display value.
 */
function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (utf8ByteLength(value) <= maxBytes) return value;
  return Buffer.from(value, "utf8").subarray(0, maxBytes).toString("utf8");
}

/**
 * Serializes `value` to JSON, capping the result to `maxBytes`. Returns null for
 * null/undefined (matching the column's nullable contract). When the serialized
 * value exceeds the cap, returns a small placeholder object (still valid JSON)
 * describing what was cut, so downstream `JSON.parse` stays valid.
 */
export function capStoredJson(
  value: unknown,
  maxBytes: number = DEFAULT_MAX_STORED_PAYLOAD_BYTES,
): string | null {
  if (value == null) return null;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return null;

  const bytes = utf8ByteLength(serialized);
  if (bytes <= maxBytes) return serialized;

  return JSON.stringify({
    _truncated: true,
    _originalBytes: bytes,
    _maxBytes: maxBytes,
    _preview: truncateUtf8(serialized, JSON_PREVIEW_BYTES),
  });
}

/**
 * Caps a free-text value to `maxBytes`. Returns the value unchanged when it is
 * null/undefined or within the cap; otherwise truncates on a UTF-8 boundary and
 * appends a marker naming the original size. The marker is included in the
 * budget so the result stays at or under `maxBytes`.
 */
export function capStoredText<T extends string | null | undefined>(
  value: T,
  maxBytes: number = DEFAULT_MAX_STORED_PAYLOAD_BYTES,
): T {
  if (typeof value !== "string") return value;
  const bytes = utf8ByteLength(value);
  if (bytes <= maxBytes) return value;

  const marker = `…[truncated: ${bytes} bytes total]`;
  const room = Math.max(0, maxBytes - utf8ByteLength(marker));
  return (truncateUtf8(value, room) + marker) as T;
}
