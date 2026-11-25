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

/** Whether values add up across time buckets, and across groups. */
type Additivity = { acrossTime: boolean; acrossGroups: boolean };

const SUMMABLE_AGGREGATIONS = new Set(["sum", "count"]);
const DISTINCT_AGGREGATIONS = new Set(["cardinality", "terms"]);

/**
 * When an aggregation's values add up. Sums and counts always do; a distinct
 * count does across time only for trace ids, and never across groups. Averages,
 * extremes, medians and percentiles never do, so their groups get one line each.
 */
function additivityOf(aggregation: string | undefined, metric: string): Additivity {
  if (aggregation == null || SUMMABLE_AGGREGATIONS.has(aggregation)) {
    return { acrossTime: true, acrossGroups: true };
  }
  if (DISTINCT_AGGREGATIONS.has(aggregation)) {
    return { acrossTime: metric === "metadata.trace_id", acrossGroups: false };
  }
  return { acrossTime: false, acrossGroups: false };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/**
 * The measure in a bucket, for an additive aggregation: everything except
 * `date`, summed, walking into the nested dimension and group objects of a
 * grouped bucket.
 */
function valueOf(bucket: AnalyticsBucket): number {
  let total = 0;
  for (const [key, raw] of Object.entries(bucket)) {
    if (key === "date") continue;
    total += measureOf(raw);
  }
  return total;
}

function measureOf(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return 0;
  let total = 0;
  for (const nested of Object.values(raw)) total += measureOf(nested);
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

/** The one finite number directly inside `record`, or null if it holds none or several. */
function singleNumber(record: Record<string, unknown>): number | null {
  const values = Object.values(record).filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  return values.length === 1 ? values[0]! : null;
}

function pushBucketPoints({
  bucket,
  t,
  title,
  push,
}: {
  bucket: AnalyticsBucket;
  t: string;
  title: string;
  push: (name: string, point: TimeseriesPoint) => void;
}): void {
  const { date: _date, ...measures } = bucket;
  const flat = singleNumber(measures);
  if (flat !== null) push(title, { t, v: flat });
  for (const groups of Object.values(measures)) {
    if (!isRecord(groups)) continue;
    for (const [group, groupMeasures] of Object.entries(groups)) {
      const v = isRecord(groupMeasures) ? singleNumber(groupMeasures) : null;
      if (v !== null) push(group, { t, v });
    }
  }
}

/**
 * The series for a non-additive aggregation: nothing is added up. A flat bucket
 * holds the period's one measure, drawn as `title`; a grouped bucket gives each
 * group its own series, named by the group.
 */
function seriesPerGroup(buckets: readonly AnalyticsBucket[], title: string): TimeseriesSeries[] {
  const byName = new Map<string, TimeseriesPoint[]>();
  const push = (name: string, point: TimeseriesPoint) => {
    const points = byName.get(name) ?? [];
    points.push(point);
    byName.set(name, points);
  };
  for (const bucket of buckets) {
    const t = dayOf(bucket);
    if (t !== null) pushBucketPoints({ bucket, t, title, push });
  }
  return [...byName.entries()].map(([name, points]) => ({ name, points }));
}

const sum = (points: readonly TimeseriesPoint[]): number =>
  points.reduce((total, point) => total + point.v, 0);

export function toTimeseriesShape({
  currentPeriod,
  previousPeriod,
  metric,
  aggregation,
}: {
  currentPeriod: readonly AnalyticsBucket[];
  previousPeriod: readonly AnalyticsBucket[];
  metric: string;
  /** How the metric was aggregated. Only additive ones are summed. */
  aggregation?: string;
}): TimeseriesShape | null {
  const title = humanMetric(metric);
  const { acrossTime, acrossGroups } = additivityOf(aggregation, metric);

  if (!acrossGroups) {
    // One point is a number, not a trend (see below), so a series needs two.
    const series = seriesPerGroup(currentPeriod, title).filter((s) => s.points.length >= 2);
    if (series.length === 0) return null;
    const previous = seriesPerGroup(previousPeriod, title);
    // The "this period vs previous" headline adds up one line's points, so it
    // is only drawn for a single line whose points add up.
    const single = series.length === 1 && series[0]!.name === title;
    const baseline = previous.find((s) => s.name === title);
    return {
      series,
      title,
      unit: unitFor(metric),
      ...(acrossTime && single && baseline && baseline.points.length > 0
        ? {
            comparison: {
              label: "This period",
              value: sum(series[0]!.points),
              baselineLabel: "Previous period",
              baseline: sum(baseline.points),
            },
          }
        : {}),
    };
  }

  const current = pointsOf(currentPeriod);
  // One point is a number, not a trend. Drawing an axis under it dresses a
  // single reading up as a shape, which is the failure this card exists to fix
  // in the other direction.
  if (current.length < 2) return null;

  const previous = pointsOf(previousPeriod);

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
