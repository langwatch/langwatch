/**
 * Postgres text/jsonb cannot store the U+0000 null byte (Postgres error 22P05).
 * User-supplied uploads (PDF copy-paste, broken CSV exports, JSONL with binary
 * artefacts) regularly carry stray null bytes; the upload pipeline must scrub
 * them silently so customers never see a Postgres error.
 *
 * This util walks JSON-shaped values recursively and removes null bytes from
 * every string. Anything else passes through untouched.
 */

const NULL_BYTE = "\u0000";
const NULL_BYTE_GLOBAL = /\u0000/g;

export const stripNullBytes = (value: unknown): unknown => {
  if (typeof value === "string") {
    return value.includes(NULL_BYTE)
      ? value.replace(NULL_BYTE_GLOBAL, "")
      : value;
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
