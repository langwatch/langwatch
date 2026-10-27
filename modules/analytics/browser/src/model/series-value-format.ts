/**
 * The `numeral` format (or formatter) a series' values render with, shared by the axis,
 * tooltip and summary paths. Percentage beats cardinality beats the metric's own unit.
 * Percentages are on the 0-100 scale, so only a `%` is suffixed: `numeral` would multiply again.
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

/** A 0-100 value with a `%` suffix, whole percents: the display twin of `filtered / all * 100`. */
function formatScaledPercent(value: number): string {
  return `${Math.round(value)}%`;
}
