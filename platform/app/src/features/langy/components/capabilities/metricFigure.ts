/**
 * The words a Langy metrics card puts around its figure: the heading and the
 * caption under the number, read off the metric key and the aggregation.
 */

/**
 * A metric key as a person would say it: `performance.total_cost` → "Total
 * cost". The API's dotted key is a lookup path, not a title, and printing it as
 * the card's heading made the card read like a stack trace.
 *
 * The namespace is dropped rather than shown — `performance.`, `metadata.` and
 * friends group metrics in a picker, and repeating that grouping in a heading
 * tells the reader nothing they asked about.
 */
export function humanMetric(key: string | undefined): string {
  if (!key) return "Metric";
  const leaf = key.split(".").pop() ?? key;
  const words = leaf.replace(/[_-]+/g, " ").trim();
  if (!words) return "Metric";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * What a count of distinct ids counts: `metadata.trace_id` counts traces. The
 * id path names the column, while the reader asked how many traces there are.
 */
const COUNTED_ENTITIES: Record<string, string> = {
  "metadata.trace_id": "traces",
  "metadata.user_id": "users",
  "metadata.thread_id": "threads",
  "metadata.span_type": "span types",
};

/** A number as an English ordinal: 1st, 2nd, 3rd, 11th, 95th. */
function ordinal(n: number): string {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
  const suffix = ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** How an aggregation reads as a caption: `p95` is "95th percentile". */
function humanAggregation(aggregation: string): string {
  const percentile = aggregation.match(/^p(\d+)$/i);
  if (percentile) return `${ordinal(Number(percentile[1]))} percentile`;
  switch (aggregation) {
    case "sum":
      return "total";
    case "avg":
      return "average";
    case "min":
      return "minimum";
    case "max":
      return "maximum";
    case "median":
      return "median";
    case "cardinality":
    case "terms":
      return "unique";
    default:
      return aggregation.replace(/[_-]+/g, " ");
  }
}

/**
 * The card's heading and the caption under its figure, read together off the
 * metric and the aggregation. A distinct count over an id is a count of
 * entities ("Traces", "7 traces"); anything else keeps the metric as the
 * heading and names the aggregation under the number ("Total cost", "total").
 */
export function describeFigure({
  metricKey,
  aggregation,
}: {
  metricKey: string | undefined;
  aggregation: string | null;
}): { title: string; caption: string } {
  const counted = metricKey ? COUNTED_ENTITIES[metricKey] : undefined;
  if (
    counted &&
    (aggregation == null ||
      aggregation === "cardinality" ||
      aggregation === "terms")
  ) {
    return {
      title: counted.charAt(0).toUpperCase() + counted.slice(1),
      caption: counted,
    };
  }
  const title = humanMetric(metricKey);
  if (!aggregation) return { title, caption: title.toLowerCase() };
  if (aggregation === "cardinality" || aggregation === "terms") {
    return { title, caption: `unique ${title.toLowerCase()}` };
  }
  return { title, caption: humanAggregation(aggregation) };
}
