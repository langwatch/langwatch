/**
 * Whether a correction actually changed an attribute, or only re-typed it.
 *
 * A correction rewrites a whole attribute record, so an attribute holding JSON
 * comes back re-serialised even when the reviewer never touched it: different
 * spacing, different key order, sometimes text where the capture held the
 * structure itself. Marking any of that as edited teaches the reader to
 * distrust the marker, which costs more than the marker is worth.
 *
 * Key order is formatting, so it does not count. Array order is content, so it
 * does.
 */

/**
 * The structure a value spells out, when it spells one out. Only text that
 * parses as an object or an array is read as JSON: "123" and 123 stay a string
 * and a number, because a correction that changed one into the other changed
 * the value.
 */
function structureOf(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null ? parsed : value;
  } catch {
    return value;
  }
}

/** One value written the one way, so that equal values write the same. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Whether two attribute values say the same thing, however they are written. */
export function sameAttributeValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return canonicalJson(structureOf(a)) === canonicalJson(structureOf(b));
}
