import type { NormalizedAttributes } from "@langwatch/trace-contract";

// Parse JSON string array; lenient [raw] fallback for unquoted labels, but
// returns [] for truncated arrays to prevent nesting loops @see ADR-066
export function parseJsonStringArray(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    const trimmed = raw.trim();
    const isTruncatedArray = trimmed.startsWith("[") && !trimmed.endsWith("]");
    if (isTruncatedArray) return [];
    return [raw];
  }
}

/**
 * Returns the value at `key` if it is a string, otherwise `undefined`.
 */
export function findStringAttribute(attrs: NormalizedAttributes, key: string): string | undefined {
  const v = attrs[key];
  return typeof v === "string" ? v : undefined;
}
