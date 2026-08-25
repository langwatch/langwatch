import type { NormalizedAttributes } from "../../schemas/spans";

/**
 * Parses a JSON-encoded string array. Falls back to the raw string as a
 * single-element array when parsing fails (common for unquoted labels), EXCEPT
 * for a truncated array, which resets to empty.
 *
 * The lenient `[raw]` fallback is deliberate and load-bearing: a caller sending
 * `langwatch.labels` as a bare `prod` rather than `["prod"]` still gets one
 * label, and both the accumulator and the origin heuristics rely on that.
 *
 * The one case it must NOT cover is a TRUNCATED array. Several of these keys are
 * read-modify-write accumulators whose value is read back off the fold's own
 * committed row (ADR-066), and the analytics trim caps that value, cutting the
 * JSON mid-array. Handing the fragment back as `[raw]` makes it a single fake
 * element that gets re-escaped into a fresh array on the next write — so it
 * nests one level deeper on EVERY read-back cycle, and the garbage flows on to
 * every downstream reader of `langwatch.prompt_ids`. A truncated array is
 * recognised structurally — opens with `[`, does not close with `]` — which
 * needs no coupling to the trim's cap or ellipsis, and returns `[]` so the union
 * simply restarts. A bare string never opens with `[`, so the lenient path is
 * untouched, and a genuine `[...]` that merely fails to parse still gets it.
 */
export function parseJsonStringArray(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    const trimmed = raw.trim();
    if (trimmed.startsWith("[") && !trimmed.endsWith("]")) return [];
    return [raw];
  }
}

/**
 * Returns the value at `key` if it is a string, otherwise `undefined`.
 */
export function stringAttr(attrs: NormalizedAttributes, key: string): string | undefined {
  const v = attrs[key];
  return typeof v === "string" ? v : undefined;
}
