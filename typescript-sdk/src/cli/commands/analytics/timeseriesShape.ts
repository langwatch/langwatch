/**
 * Turns an analytics result into the shape the timeseries CARD reads.
 *
 * Why here, and not in the renderer. The card wants named series of `{t, v}`
 * points; the analytics API answers with `currentPeriod` / `previousPeriod`
 * arrays of `{ date, <metricKey>: number }`. Something has to bridge those two,
 * and this command is the only place that can do it honestly — it is the one
 * that knows which metric was asked for, which aggregation, and over what
 * window. A renderer handed the raw payload would have to GUESS which numeric
 * key is the measure and what to call it, and a card that guesses its own axis
 * label is a card that will eventually mislabel someone's bill.
 *
 * Emitting the shape here also means card selection stays what ADR-059 says it
 * is: a payload is promoted because of what it demonstrably IS, not because a
 * model asserted a chart into existence.
 *
 * The raw `currentPeriod` / `previousPeriod` stay on the payload alongside this.
 * Nothing that reads them today has to change, and a consumer that wants the
 * unshaped numbers still has them.
 */

/** A bucket as the analytics API returns it: a date plus one or more measures. */
export type AnalyticsBucket = Record<string, unknown> & { date?: unknown };

export interface TimeseriesPoint {
  /** ISO day. The card uses this verbatim as the x-axis label. */
  t: string;
  v: number;
}

export interface TimeseriesSeries {
  name: string;
  points: TimeseriesPoint[];
}

export interface TimeseriesShape {
  series: TimeseriesSeries[];
  title: string;
  unit?: "usd" | "count" | "ms" | "percent" | "tokens";
  comparison?: {
    label: string;
    value: number;
    baselineLabel: string;
    baseline: number;
  };
}

/**
 * What a metric is measured IN, read off the metric path the caller asked for.
 *
 * Off the METRIC, deliberately — never off the values. A day whose costs happen
 * to land between 0 and 1 is not a percentage, and a renderer sniffing the
 * numbers would decide it was. The metric path is a declaration; the values are
 * a coincidence.
 */
export function unitFor(metric: string): TimeseriesShape["unit"] {
  if (/cost/i.test(metric)) return "usd";
  if (/token/i.test(metric)) return "tokens";
  if (/time|latency|duration/i.test(metric)) return "ms";
  if (/rate|ratio|percent/i.test(metric)) return "percent";
  return "count";
}

/** `performance.total_cost` -> `Total cost`. The metric path is not a title. */
export function humanMetric(metric: string): string {
  const leaf = metric.split(".").pop() ?? metric;
  const words = leaf.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The measure in a bucket. Everything except `date` is a measure; with a
 * `groupBy` there are several, and they are summed — the chart is one line per
 * period, and a total is the only reading of several groups that is true
 * regardless of which groups happened to be present on a given day.
 */
function valueOf(bucket: AnalyticsBucket): number {
  let total = 0;
  for (const [key, raw] of Object.entries(bucket)) {
    if (key === "date") continue;
    if (typeof raw === "number" && Number.isFinite(raw)) total += raw;
  }
  return total;
}

/** The bucket's day, as an ISO date. Buckets without one are dropped: a point
 *  with no position on the x axis cannot be drawn, only invented. */
function dayOf(bucket: AnalyticsBucket): string | null {
  const raw = bucket.date;
  const ms =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Date.parse(raw)
        : NaN;
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function pointsOf(buckets: readonly AnalyticsBucket[]): TimeseriesPoint[] {
  const points: TimeseriesPoint[] = [];
  for (const bucket of buckets) {
    const t = dayOf(bucket);
    if (t === null) continue;
    points.push({ t, v: valueOf(bucket) });
  }
  return points;
}

const sum = (points: readonly TimeseriesPoint[]): number =>
  points.reduce((total, point) => total + point.v, 0);

export function toTimeseriesShape({
  currentPeriod,
  previousPeriod,
  metric,
}: {
  currentPeriod: readonly AnalyticsBucket[];
  previousPeriod: readonly AnalyticsBucket[];
  metric: string;
}): TimeseriesShape | null {
  const current = pointsOf(currentPeriod);
  // One point is a number, not a trend. Drawing an axis under it dresses a
  // single reading up as a shape, which is the failure this card exists to fix
  // in the other direction.
  if (current.length < 2) return null;

  const previous = pointsOf(previousPeriod);
  const title = humanMetric(metric);

  return {
    series: [{ name: title, points: current }],
    title,
    unit: unitFor(metric),
    // Only when there is a previous period to compare against. A "vs previous"
    // headline reading "vs 0" is not a comparison, it is an artefact.
    ...(previous.length > 0
      ? {
          comparison: {
            label: "This period",
            value: sum(current),
            baselineLabel: "Previous period",
            baseline: sum(previous),
          },
        }
      : {}),
  };
}
