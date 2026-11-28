/**
 * Which table a window-scale read of a span's type scans. `stored_spans` keeps the type in
 * `SpanAttributes`, and reading one key decompresses the whole map with every captured input and
 * output; `span_analytics` keeps it as the plain `SpanType` column, filled by the same rule.
 * @see specs/analytics/span-type-light-reads.feature
 */

import { Temporal } from "@langwatch/time";

import type { SpanAnalyticsFloor } from "../../trace.api.ts";

/**
 * `span_analytics` alone, `stored_spans` alone, or `span_analytics` from `fromMs` on with
 * `stored_spans` before it.
 */
export type SpanAnalyticsSource =
  | { readonly kind: "stored_spans" }
  | { readonly kind: "span_analytics" }
  | { readonly kind: "split"; readonly fromMs: number };

/** The read every caller without a floor keeps: the map on `stored_spans`, as before. */
export const STORED_SPANS_SOURCE: SpanAnalyticsSource = { kind: "stored_spans" };

/** A floor no read may trust, for a floor never asked for or not readable: stored_spans. */
export const UNKNOWN_SPAN_ANALYTICS_FLOOR: SpanAnalyticsFloor = { from: null, rebuilding: true };

const SPAN_ANALYTICS_SOURCE: SpanAnalyticsSource = { kind: "span_analytics" };

/**
 * The source for a read whose span bound starts at `windowStartMs` (no bound: the whole history).
 * No floor, a rebuilding one or one that does not parse keeps `stored_spans`.
 */
export function spanAnalyticsSourceOf({
  floor,
  windowStartMs,
}: {
  floor: SpanAnalyticsFloor | null | undefined;
  windowStartMs?: number | undefined;
}): SpanAnalyticsSource {
  if (!floor || floor.rebuilding) return STORED_SPANS_SOURCE;
  if (floor.from === null) return SPAN_ANALYTICS_SOURCE;
  let fromMs: number;
  try {
    fromMs = Temporal.Instant.from(floor.from).epochMilliseconds;
  } catch {
    return STORED_SPANS_SOURCE;
  }
  if (windowStartMs !== undefined && windowStartMs >= fromMs) return SPAN_ANALYTICS_SOURCE;
  return { kind: "split", fromMs };
}

/** Whether a legacy `filters` document narrows by span type, the one filter a floor serves. */
export function filtersReadSpanType(
  filters: Readonly<Record<string, unknown>> | undefined | null,
): boolean {
  const value = filters?.["spans.type"];
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "object" && value !== null && Object.keys(value).length > 0;
}
