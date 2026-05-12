import type { NormalizedAttributes } from "../../schemas/spans";

/**
 * Parses a JSON-encoded string array, returning the raw string as a
 * single-element array when parsing fails (common for unquoted labels).
 */
export function parseJsonStringArray(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [raw];
  }
}

/**
 * Returns the value at `key` if it is a string, otherwise `undefined`.
 */
export function stringAttr(
  attrs: NormalizedAttributes,
  key: string,
): string | undefined {
  const v = attrs[key];
  return typeof v === "string" ? v : undefined;
}
