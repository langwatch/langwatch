/**
 * Which `numeral` format string (or formatter function) a series' values
 * should render with — the same decision `CustomGraph.tsx` makes for its
 * axis ticks and tooltip, extracted so it is one framework-free function
 * instead of two copies that can drift.
 *
 * A `cardinality` aggregation always overrides the metric's own format: it
 * counts distinct things, so the metric's usual unit (ms, USD, …) is wrong
 * for it regardless of what is being counted. `isPercent` (the series' stored `asPercent`) overrides both —
 * a percentage series is never displayed in the metric's native unit, it is
 * always a share of a whole. The query builder emits it on the 0-100 scale
 * (the ES `bucket_script` contract graph-alert thresholds are authored
 * against), so the formatter only suffixes `%` — `numeral`'s `%` token would
 * multiply the already-scaled value by 100 again.
 */
export function resolveSeriesValueFormat({
  isPercent,
  aggregation,
  metricFormat,
}: {
  isPercent?: boolean;
  aggregation?: string;
  metricFormat?: string | ((value: number) => string);
}): string | ((value: number) => string) | undefined {
  if (isPercent) return formatScaledPercent;
  if (aggregation === "cardinality") return "0a";
  return metricFormat;
}

/** A 0-100 value with a `%` suffix, whole percents — the display twin of the
 *  builder's `filtered / all * 100`. */
function formatScaledPercent(value: number): string {
  return `${Math.round(value)}%`;
}
