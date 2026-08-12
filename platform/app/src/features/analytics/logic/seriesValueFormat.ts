/**
 * Which `numeral` format string (or formatter function) a series' values
 * should render with — the same decision `CustomGraph.tsx` makes for its
 * axis ticks and tooltip, extracted so it is one framework-free function
 * instead of two copies that can drift.
 *
 * A `cardinality` aggregation always overrides the metric's own format: it
 * counts distinct things, so the metric's usual unit (ms, USD, …) is wrong
 * for it regardless of what is being counted. `asPercent` overrides both —
 * a percentage series is never displayed in the metric's native unit, it is
 * always a share of a whole, formatted 0-100 with a trailing `%` the way
 * `numeral`'s `%` token already renders a 0-1 fraction (matches the existing
 * `evaluation_pass_rate` metric's own `"0%"` format in
 * `server/analytics/registry.ts`).
 */
export function resolveSeriesValueFormat({
  asPercent,
  aggregation,
  metricFormat,
}: {
  asPercent?: boolean;
  aggregation?: string;
  metricFormat?: string | ((value: number) => string);
}): string | ((value: number) => string) | undefined {
  if (asPercent) return "0%";
  if (aggregation === "cardinality") return "0a";
  return metricFormat;
}
