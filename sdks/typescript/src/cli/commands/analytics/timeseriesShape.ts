/**
 * Transforms analytics API response to timeseries card shape. Lives here because
 * only the command knows the metric, aggregation, and window being queried.
 * @see dev/docs/adr/079-card-selection.md
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
 * What a metric is measured IN, read off the metric path, never off the
 * values -- a day whose costs land between 0 and 1 is not a percentage. The
 * metric path is a declaration; the values are a coincidence.
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
 * The measure in a bucket: everything except `date`. With a `groupBy` there
 * are several, summed -- a total is the only reading that stays true
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
  let ms = NaN;
  if (typeof raw === "number") ms = raw;
  else if (typeof raw === "string") ms = Date.parse(raw);
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
