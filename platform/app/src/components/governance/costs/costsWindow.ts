/**
 * The choices the Costs filter bar offers, and the one transformation they
 * imply that the API does not already do for us.
 *
 * Time frame and group-by are passed straight to `api.activityMonitor.*`.
 * Time interval is applied here instead: the spend endpoints return daily
 * buckets and nothing else, so weekly and monthly views are folded from those
 * days on the client rather than re-queried.
 */

import type { DailyBucket } from "./sampleSeries";

export const TIME_FRAMES = [
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
] as const;

export type TimeInterval = "day" | "week" | "month";

export const TIME_INTERVALS: Array<{ value: TimeInterval; label: string }> = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

export type GroupBy = "team" | "user" | "model";

export const GROUP_BYS: Array<{ value: GroupBy; label: string }> = [
  { value: "team", label: "Team" },
  { value: "user", label: "User" },
  { value: "model", label: "Model" },
];

export const ALL_DEPARTMENTS = "__all__";

/**
 * The ISO day that starts the bucket `day` falls into. Weeks start Monday;
 * months start on the first. Days are returned unchanged, which is what makes
 * the day case free rather than a no-op pass over the data.
 */
function bucketStartOf(day: string, interval: TimeInterval): string {
  if (interval === "day") return day;
  const date = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  if (interval === "month") {
    date.setUTCDate(1);
    return date.toISOString().slice(0, 10);
  }
  // Monday-start weeks: getUTCDay() is 0 on Sunday, which is 6 days in.
  const dayOfWeek = date.getUTCDay();
  const backToMonday = (dayOfWeek + 6) % 7;
  date.setUTCDate(date.getUTCDate() - backToMonday);
  return date.toISOString().slice(0, 10);
}

/**
 * Fold daily buckets into weekly or monthly ones, summing each series across
 * the days it covers. Series absent from some days simply contribute nothing
 * on those days rather than dropping out of the fold.
 */
export function aggregateBuckets(
  buckets: DailyBucket[],
  interval: TimeInterval,
): DailyBucket[] {
  if (interval === "day") return buckets;

  const byBucket = new Map<
    string,
    Map<string, { label: string; value: number }>
  >();
  for (const bucket of buckets) {
    const start = bucketStartOf(bucket.day, interval);
    let series = byBucket.get(start);
    if (!series) {
      series = new Map();
      byBucket.set(start, series);
    }
    for (const point of bucket.points) {
      const existing = series.get(point.key);
      if (existing) {
        existing.value += point.value;
      } else {
        series.set(point.key, { label: point.label, value: point.value });
      }
    }
  }

  return [...byBucket.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, series]) => ({
      day,
      points: [...series.entries()].map(([key, { label, value }]) => ({
        key,
        label,
        value,
      })),
    }));
}

/** The same fold for a single unstacked line. */
export function aggregateLine(
  points: Array<{ day: string; value: number }>,
  interval: TimeInterval,
): Array<{ day: string; value: number }> {
  if (interval === "day") return points;

  const totals = new Map<string, number>();
  for (const point of points) {
    const start = bucketStartOf(point.day, interval);
    totals.set(start, (totals.get(start) ?? 0) + point.value);
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, value]) => ({ day, value }));
}
