// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { type DailyBucket } from "./sample-series.ts";

export function seriesKeysOf(buckets: DailyBucket[]): {
  key: string;
  label: string;
}[] {
  const labelByKey = new Map<string, string>();
  for (const bucket of buckets) {
    for (const point of bucket.points) {
      if (!labelByKey.has(point.key)) labelByKey.set(point.key, point.label);
    }
  }
  return [...labelByKey.entries()].map(([key, label]) => ({ key, label }));
}

export function widenBuckets(
  buckets: DailyBucket[],
  keys: { key: string; label: string }[],
): Record<string, number | string>[] {
  return buckets.map((bucket) => {
    const row: Record<string, number | string> = { day: bucket.day };
    for (const k of keys) row[k.key] = 0;
    for (const point of bucket.points) row[point.key] = point.value;
    return row;
  });
}

/**
 * Where the projection begins: the LAST MEASURED bucket, and its position as a
 * fraction of the plot's width.
 *
 * ANCHORING ON THE MEASURED SIDE is what makes the region visible at all. A
 * category axis puts each bucket at a point, so a projection of one bucket —
 * which is what a quarter ahead folds to on a screen set to Quarter — has no
 * width: shading from the first projected bucket to the last ran from the last
 * point to the last point and drew nothing at all, which is the complaint this
 * rework began with.
 *
 * The segment between two points belongs to neither of its ends alone, so one
 * of them has to claim it. The measured side claims it, which draws a little of
 * what is known as though it were forecast. That is the direction the marker's
 * own fold already rounds, and for the same reason: showing a projection as
 * spend is the error worth engineering against, and calling a few measured days
 * projected only costs the reader some certainty.
 *
 * Null when nothing is projected, when the boundary names no bucket the chart
 * draws, or when there is no measured bucket to leave from. The chart then says
 * nothing about a projection rather than shading a span it cannot justify.
 */
export function projectionSpan(
  rows: Record<string, number | string>[],
  projectedFromDay: string | null,
): { from: string; at: number } | null {
  if (!projectedFromDay || rows.length < 2) return null;
  const first = rows.findIndex((row) => row.day === projectedFromDay);
  if (first <= 0) return null;
  const from = rows[first - 1]?.day;
  if (from === undefined) return null;
  return { from: String(from), at: (first - 1) / (rows.length - 1) };
}
