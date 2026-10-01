/**
 * The object a stored JSON column holds, or null when the column was empty.
 * A column we wrote that no longer parses is corruption, not absence, so it
 * throws rather than reading back as "this row had no inputs".
 */
export function parseJsonSafely(json: string | null): Record<string, unknown> | null {
  if (!json) {
    return null;
  }

  return JSON.parse(json);
}
