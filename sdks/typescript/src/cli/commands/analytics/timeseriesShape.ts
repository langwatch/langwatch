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
 * Emitting the shape here also means card selection stays what ADR-079 says it
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
 * Aggregations whose values add up across groups and buckets. The groups of a
 * sum add up to the sum; the groups of an average, a minimum, a maximum, a
 * median or a percentile do not, so those are drawn one line per group.
 */
const ADDITIVE_AGGREGATIONS = new Set(["sum", "count", "cardinality", "terms"]);

const isAdditive = (aggregation: string | undefined): boolean =>
  aggregation == null || ADDITIVE_AGGREGATIONS.has(aggregation);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/**
 * The measure in a bucket, for an additive aggregation. Everything except
 * `date` is a measure; with a `groupBy` there are several, and they are summed:
 * the chart is one line per period, and a total is the only reading of several
 * groups that is true regardless of which groups happened to be present on a
 * given day.
 *
 * A grouped bucket nests its measures under the dimension and then the group
 * (`{ "metadata.model": { "gpt-5-mini": { "0/...": 7 } } }`), so objects are
 * walked into rather than skipped.
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

/** The one finite number directly inside `record`, or null if it holds none or several. */
function singleNumber(record: Record<string, unknown>): number | null {
  const values = Object.values(record).filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  return values.length === 1 ? values[0]! : null;
}

/**
 * The series for a non-additive aggregation: nothing is added up. A flat bucket
 * holds the period's one measure, drawn as `title`; a grouped bucket gives each
 * group its own series, named by the group.
 */
function seriesPerGroup(
  buckets: readonly AnalyticsBucket[],
  title: string,
): TimeseriesSeries[] {
  const byName = new Map<string, TimeseriesPoint[]>();
  const push = (name: string, point: TimeseriesPoint) => {
    const points = byName.get(name) ?? [];
    points.push(point);
    byName.set(name, points);
  };
  for (const bucket of buckets) {
    const t = dayOf(bucket);
    if (t === null) continue;
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

  if (!isAdditive(aggregation)) {
    // One point is a number, not a trend (see below), so a series needs two.
    const series = seriesPerGroup(currentPeriod, title).filter(
      (s) => s.points.length >= 2,
    );
    if (series.length === 0) return null;
    // No "this period vs previous" headline: it adds up the points, and the
    // points of an average do not add up to anything.
    return { series, title, unit: unitFor(metric) };
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
