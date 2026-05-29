/**
 * capStoredJson — bounds the byte-size of a large serialized-JSON value before
 * it is written into the hot ClickHouse path (evaluation_runs.Inputs).
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
 * The column is JSON-parsed on read, so a mid-string truncation would break
 * `JSON.parse`. An oversized value is therefore replaced with a small,
 * still-valid JSON placeholder that carries the original size and a preview.
 * Allocation-light, never throws, leaves normal-sized values byte-for-byte
 * unchanged.
 */

const KB = 1024;

/**
 * Generous default cap (32KB). Normal evaluator inputs and trace IO are a few
 * KB; this only trips on the multi-MB tail from agentic full-conversation
 * payloads. Override per call site / via env if a tighter bound is needed.
 */
export const DEFAULT_MAX_STORED_PAYLOAD_BYTES = 32 * KB;

/** Upper bound on the debugging preview kept inside a JSON placeholder. */
const JSON_PREVIEW_BYTES = 2 * KB;

/**
 * Generous allowance for the placeholder's fixed parts (the metadata keys, the
 * numeric values, and JSON punctuation) so the preview budget leaves room for
 * them under a tight cap.
 */
const PLACEHOLDER_OVERHEAD_BYTES = 128;

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

  // Bound the preview by the cap, not just the fixed upper limit, so a caller
  // passing a tighter maxBytes still gets a placeholder within the cap.
  const previewBudget = Math.max(
    0,
    Math.min(JSON_PREVIEW_BYTES, maxBytes - PLACEHOLDER_OVERHEAD_BYTES),
  );
  const placeholder = JSON.stringify({
    _truncated: true,
    _originalBytes: bytes,
    _maxBytes: maxBytes,
    _preview: truncateUtf8(serialized, previewBudget),
  });
  // JSON-escaping the preview can expand it past the budget; if the placeholder
  // still exceeds the cap, drop the preview so the result is guaranteed within
  // maxBytes (the no-preview skeleton fits any realistic cap).
  if (utf8ByteLength(placeholder) <= maxBytes) return placeholder;
  return JSON.stringify({
    _truncated: true,
    _originalBytes: bytes,
    _maxBytes: maxBytes,
    _preview: "",
  });
}
