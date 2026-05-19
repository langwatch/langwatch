/**
 * Coerces a message's `content` field to an array we can walk.
 *
 * Some SDK callers (notably the langwatch python-sdk) send `content` as a
 * stringified Python-repr of a list (`"[{'type': 'input_audio', ...}]"`)
 * instead of a JSON-encoded array. This isn't strictly valid JSON, but it's
 * mechanically recoverable: single quotes -> double quotes, then JSON.parse.
 *
 * Returns:
 *  - The array verbatim when content is already an array.
 *  - A parsed array when content is a string that decodes (JSON or
 *    Python-repr) to an array of objects.
 *  - null otherwise (caller should pass through unchanged).
 */
export function coerceContentToArray(content: unknown): unknown[] | null {
  if (Array.isArray(content)) return content;
  if (typeof content !== "string") return null;

  const trimmed = content.trim();
  if (!trimmed.startsWith("[")) return null;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // fall through
  }

  const jsonified = trimmed
    .replace(/'/g, '"')
    .replace(/\bNone\b/g, "null")
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false");
  try {
    const parsed = JSON.parse(jsonified) as unknown;
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // give up
  }

  return null;
}
