/** Postgres cannot store U+0000 null bytes. User uploads (PDF, broken CSV,
 * JSONL) carry stray nulls; recursively scrub them.
 */

const NULL_BYTE = "\u0000";

export const stripNullBytes = (value: unknown): unknown => {
  if (typeof value === "string") {
    return value.includes(NULL_BYTE) ? value.replaceAll(NULL_BYTE, "") : value;
  }
  if (Array.isArray(value)) {
    return value.map(stripNullBytes);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = stripNullBytes(v);
    }
    return out;
  }
  return value;
};
