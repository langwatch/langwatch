import { Temporal } from "@langwatch/time";

import type { NormalizedAttributes } from "./trace.spans.ts";

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

/**
 * The latest instant a span time may carry: the `DateTime64(3)` ceiling, and
 * well inside the KSUID's 48-bit seconds field the span record id is minted
 * over. @see specs/traces/span-start-time-must-be-storable.feature
 */
export const MAX_STORABLE_SPAN_TIME_MS = Temporal.Instant.from(
  "2299-12-31T23:59:59.999Z",
).epochMilliseconds;

/** An epoch-ms instant storage can hold: finite, positive, under the ceiling. */
export function isStorableSpanTimeMs(valueMs: number | null | undefined): valueMs is number {
  return (
    typeof valueMs === "number" &&
    Number.isFinite(valueMs) &&
    valueMs > 0 &&
    valueMs <= MAX_STORABLE_SPAN_TIME_MS
  );
}
