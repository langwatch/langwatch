// ---------------------------------------------------------------------------
// Leaf-only string truncation for Elasticsearch flattened fields
// ---------------------------------------------------------------------------

/**
 * Elasticsearch flattened fields store terms as `key_path\0value` in Lucene,
 * which enforces a hard 32,766-byte limit per term. The function tracks the
 * accumulated key path and subtracts its byte length from the budget so that
 * the combined term always fits, regardless of nesting depth.
 */
const ES_FLATTENED_TERM_LIMIT = 32_766;

const TRUNCATION_MARKER = "...[truncated]";

const encoder = new TextEncoder();
const TRUNCATION_MARKER_BYTES = encoder.encode(TRUNCATION_MARKER).length;

/**
 * Truncate a single string so its UTF-8 byte length fits within `maxBytes`.
 * Appends `...[truncated]` when clipping occurs. Never splits mid-character.
 */
function truncateStringByBytes(
  str: string,
  maxBytes: number,
): string {
  const encoded = encoder.encode(str);
  if (encoded.length <= maxBytes) return str;

  // Leave room for the marker
  const targetBytes = maxBytes - TRUNCATION_MARKER_BYTES;
  if (targetBytes <= 0) return TRUNCATION_MARKER;

  // Walk back from targetBytes to avoid splitting a multi-byte character.
  // UTF-8 continuation bytes start with 0b10xxxxxx (0x80..0xBF).
  let end = targetBytes;
  while (end > 0 && encoded[end]! >= 0x80 && encoded[end]! < 0xc0) {
    end--;
  }

  return new TextDecoder().decode(encoded.subarray(0, end)) + TRUNCATION_MARKER;
}

/**
 * Recursively walk `data` and truncate any leaf string so that the combined
 * ES flattened-field term (`key_path\0value`) stays within 32,766 bytes.
 * Object structure is always preserved — keys are never dropped.
 *
 * The function tracks the accumulated dotted key path as it recurses into
 * objects, and subtracts its byte length (+ 1 for the \0 separator) from
 * the per-leaf budget. This is correct for any nesting depth.
 *
 * Use this at the Elasticsearch write boundary. ClickHouse has no such
 * constraint and needs no truncation.
 */
export function truncateLeafStrings<T>(
  data: T,
  termLimit = ES_FLATTENED_TERM_LIMIT,
): T {
  return truncateLeaves(data, termLimit, "") as T;
}

function truncateLeaves(
  data: unknown,
  termLimit: number,
  keyPath: string,
): unknown {
  if (typeof data === "string") {
    // Budget = termLimit - keyPath bytes - 1 (\0 separator)
    // When keyPath is empty (top-level string), no overhead.
    const keyOverhead =
      keyPath.length > 0 ? encoder.encode(keyPath).length + 1 : 0;
    const maxValueBytes = termLimit - keyOverhead;
    return truncateStringByBytes(data, maxValueBytes);
  }

  if (Array.isArray(data)) {
    return data.map((item) => truncateLeaves(item, termLimit, keyPath));
  }

  if (typeof data === "object" && data !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      const childPath = keyPath ? `${keyPath}.${key}` : key;
      result[key] = truncateLeaves(value, termLimit, childPath);
    }
    return result;
  }

  return data;
}
