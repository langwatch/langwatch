/**
 * Whether a dashboard read reads span types, the one span fact span_analytics serves to it.
 * @see specs/analytics/span-type-light-reads.feature
 */

import type { AnalyticsTimeseriesInput } from "@langwatch/analytics-contract";
import { filtersReadSpanType } from "@langwatch/trace-contract";

/** The metrics and grouping that read a span's type. */
const SPAN_TYPE_KEYS: ReadonlySet<string> = new Set(["spans.type", "metadata.span_type"]);

/** A filter, a series' own filter, a series metric or the grouping naming a span type. */
export function timeseriesReadsSpanType(input: AnalyticsTimeseriesInput): boolean {
  if (filtersReadSpanType(input.filters)) return true;
  if (input.groupBy !== undefined && SPAN_TYPE_KEYS.has(input.groupBy)) return true;
  return input.series.some(
    (series) => SPAN_TYPE_KEYS.has(series.metric) || filtersReadSpanType(series.filters),
  );
}
