/**
 * How the Costs page's two time chips reach the reads underneath it, and the
 * folds that turn what those reads answer into the buckets the chips asked for.
 *
 * The chips themselves are the section-wide ones in
 * `~/components/governance/filters` — Time Frame (how far back) and Time
 * Interval (how wide each bucket is), Month / Quarter / Year, opening on
 * Quarter over the last 12 months. Nothing about the options lives here; only
 * the two things that are this page's own problem.
 *
 * THE FOLD. Every cost read on this page answers in DAYS and takes no bucket
 * parameter at all (`activityMonitor.spendOverTime` and friends emit one dense
 * daily bucket per day in the window, and `governanceCost.summary` emits one
 * `GovernanceCostDayDto` per day). Month, quarter and year are therefore
 * folded from those days here, on the client, rather than re-queried — the
 * same arrangement the page has always had for its weekly and monthly views,
 * widened to the governance cadence. Folding straight from days rather than
 * via months is deliberate: a two-step fold would round twice and can only
 * lose figures a single pass keeps exact.
 *
 * THE CEILING. Those reads cap `windowDays` at 365 (`z.number().max(365)` on
 * every governance cost input). The Time Frame chip offers Last 2 years, which
 * is 730. Asking for it would fail validation and land the reader on an error
 * alert, so the request is clamped to the ceiling and the page says the
 * figures cover twelve months — a stated shortfall rather than a silent one.
 * Widening the server input is the real fix and is not this change's to make.
 */

import {
  frameSpanDays,
  type TimeFrame,
  type TimeInterval,
} from "~/components/governance/filters";

import type { DailyBucket } from "./sampleSeries";

export const ALL_DEPARTMENTS = "__all__";

/**
 * The furthest back any governance cost read will answer, in days.
 *
 * Mirrors `z.number().int().min(1).max(365)` on `governanceCost.summary`,
 * `governanceCost.spenders` and every `activityMonitor` spend input. A
 * constant rather than a magic 365 at the call site so the one place that has
 * to change when the server widens is findable.
 */
export const READ_WINDOW_DAY_CEILING = 365;

/** The window to request for a frame, clamped to what the reads will answer. */
export function windowDaysForFrame({
  frame,
  now,
}: {
  frame: TimeFrame;
  now?: Date;
}): number {
  return Math.min(READ_WINDOW_DAY_CEILING, frameSpanDays({ frame, now }));
}

/** Whether the frame asks for more history than the reads can answer. */
export function frameExceedsReadCeiling({
  frame,
  now,
}: {
  frame: TimeFrame;
  now?: Date;
}): boolean {
  return frameSpanDays({ frame, now }) > READ_WINDOW_DAY_CEILING;
}

/**
 * The ISO day that starts the bucket `day` falls into.
 *
 * Months start on the first, quarters on the first of January, April, July or
 * October, years on the first of January. Everything is computed in UTC
 * because the reads emit UTC business days, and reading them in the browser's
 * zone would move a day across a bucket boundary for anyone west of Greenwich.
 */
export function bucketStartOf(day: string, interval: TimeInterval): string {
  const date = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  const year = date.getUTCFullYear();
  if (interval === "year") return `${year}-01-01`;
  const month =
    interval === "quarter"
      ? Math.floor(date.getUTCMonth() / 3) * 3
      : date.getUTCMonth();
  return `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

/**
 * Fold daily buckets into the chosen interval, summing each series across the
 * days it covers. Series absent from some days contribute nothing on those
 * days rather than dropping out of the fold.
 */
export function aggregateBuckets(
  buckets: DailyBucket[],
  interval: TimeInterval,
): DailyBucket[] {
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
  const totals = new Map<string, number>();
  for (const point of points) {
    const start = bucketStartOf(point.day, interval);
    totals.set(start, (totals.get(start) ?? 0) + point.value);
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, value]) => ({ day, value }));
}

/**
 * The tick a bucket start reads as, for the interval it belongs to.
 *
 * One formatter for every time chart on the page, because the axis is the one
 * thing every chart here shares: a page whose forecast is ticked by quarter
 * and whose seat counts are ticked by day invites the reader to compare two
 * spans that are not the same span. `Q3 2026` rather than `Jul 2026` for a
 * quarter, because a quarter labelled by its first month reads as that month.
 */
export function formatBucketTick(
  bucketStart: string | number,
  interval: TimeInterval,
): string {
  const iso = String(bucketStart).slice(0, 10);
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return String(bucketStart);
  const year = parsed.getUTCFullYear();
  if (interval === "year") return String(year);
  if (interval === "quarter") {
    return `Q${Math.floor(parsed.getUTCMonth() / 3) + 1} ${year}`;
  }
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The lane series, folded to the chosen interval.
 *
 * Every rule the per-day DTO follows survives the fold, because each one is a
 * rule about not stating a figure we cannot stand behind and a wider bucket
 * cannot make us able to:
 *
 * - A bucket holding any day with no figure for a lane holds no figure for
 *   that lane either. Summing only the days we do have would draw a total
 *   lower than the period cost with nothing on the chart saying so — the same
 *   lie `billedUsd` refuses to tell for a single day.
 * - Cells nobody could price are added up, so the note explaining the gap
 *   still knows how big the gap is.
 * - `revised` and `provisional` are ORed: a quarter containing one restated
 *   day is a quarter that was restated, and one settling day is a quarter
 *   that can still move.
 * - The "was $X" figure survives only when every day in the bucket carries
 *   one. A partial prior total reads as the whole one (ADR-128 §15).
 * - The restatement timestamp kept is the most recent in the bucket, which is
 *   what "revised [date]" means for a period.
 *
 * NOTHING ON THE SCREEN CALLS THIS TODAY. Its one caller was the full-width
 * billed-against-metered chart, removed because it was the largest thing on a
 * page that already carried four time series. The fold is kept rather than
 * deleted because the rules above are the contract for drawing a lane over
 * time at all, and the next lane chart has to obey them — three @unit
 * scenarios in specs/governance/governance-cost-screen.feature are bound to
 * them. If that chart is never coming back, the scenarios go first and this
 * follows; do not delete one without the other.
 */
export function aggregateLaneSeries<
  T extends {
    day: string;
    billedUsd: number | null;
    gatewayUsd: number | null;
    billedCellsWithoutAmount: number;
    gatewayCellsWithoutAmount: number;
    billedRevisedAt: number | null;
    billedByCurrency: ReadonlyArray<{
      currencyCode: string;
      amount: number | null;
      previousAmount: number | null;
    }>;
    billedProvisional: boolean;
  },
>(series: readonly T[], interval: TimeInterval): T[] {
  const byBucket = new Map<string, T>();
  for (const day of series) {
    const start = bucketStartOf(day.day, interval);
    const held = byBucket.get(start);
    if (!held) {
      byBucket.set(start, { ...day, day: start });
      continue;
    }
    byBucket.set(start, {
      ...held,
      billedUsd: addOrWithhold(held.billedUsd, day.billedUsd),
      gatewayUsd: addOrWithhold(held.gatewayUsd, day.gatewayUsd),
      billedCellsWithoutAmount:
        held.billedCellsWithoutAmount + day.billedCellsWithoutAmount,
      gatewayCellsWithoutAmount:
        held.gatewayCellsWithoutAmount + day.gatewayCellsWithoutAmount,
      billedRevisedAt: laterOf(held.billedRevisedAt, day.billedRevisedAt),
      billedByCurrency: addCurrencyLines(
        held.billedByCurrency,
        day.billedByCurrency,
      ),
      billedProvisional: held.billedProvisional || day.billedProvisional,
    });
  }
  return [...byBucket.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Two days' currency lines added DOWN each currency, never across them.
 *
 * A period holding dollars and euros holds two figures, exactly as a day does,
 * and there is no rate here to make one of them out of the other. Each line
 * withholds on the same rule the period's own figure does: one day of the
 * period missing a figure withholds the period's, because a partial sum reads
 * as the whole one.
 */
function addCurrencyLines(
  held: ReadonlyArray<{
    currencyCode: string;
    amount: number | null;
    previousAmount: number | null;
  }>,
  day: ReadonlyArray<{
    currencyCode: string;
    amount: number | null;
    previousAmount: number | null;
  }>,
): Array<{
  currencyCode: string;
  amount: number | null;
  previousAmount: number | null;
}> {
  const byCode = new Map(held.map((line) => [line.currencyCode, line]));
  for (const line of day) {
    const standing = byCode.get(line.currencyCode);
    byCode.set(
      line.currencyCode,
      standing
        ? {
            currencyCode: line.currencyCode,
            amount: addOrWithhold(standing.amount, line.amount),
            previousAmount: addOrWithhold(
              standing.previousAmount,
              line.previousAmount,
            ),
          }
        : line,
    );
  }
  return [...byCode.values()].sort((a, b) =>
    a.currencyCode.localeCompare(b.currencyCode),
  );
}

/** Sum two lane figures, or withhold the sum when either is missing. */
function addOrWithhold(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return a + b;
}

/** The later of two restatement timestamps, either of which may be absent. */
function laterOf(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/**
 * Seat counts folded to the interval by taking the LAST period in each bucket,
 * never by summing it.
 *
 * A seat count is a level, not a flow. A company holding 420 seats in each of
 * three months holds 420 at the end of the quarter, never 1,260. Every other
 * series on this page is money spent, which does add up, and reaching for the
 * money fold here is the mistake this function exists to make impossible.
 */
export function aggregateSeatCounts(
  buckets: DailyBucket[],
  interval: TimeInterval,
): DailyBucket[] {
  const byBucket = new Map<string, DailyBucket>();
  // Ascending, so each write leaves the latest period of its bucket standing.
  for (const bucket of [...buckets].sort((a, b) =>
    a.day.localeCompare(b.day),
  )) {
    byBucket.set(bucketStartOf(bucket.day, interval), {
      day: bucketStartOf(bucket.day, interval),
      points: bucket.points,
    });
  }
  return [...byBucket.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * A lane's own series folded to the interval, with withheld days kept withheld.
 *
 * `aggregateLine` cannot be used here because it takes plain numbers, and this
 * series carries nulls that mean something: ADR-128 §21 writes null on a day
 * whose figure the read would not state, and summing that as zero would report
 * money not spent where the truth is money not stated. A bucket holding
 * nothing but withheld days stays withheld; one holding a single stated day
 * totals that day and no more.
 *
 * The fold exists at all because the filter bar promises every chart on the
 * screen is bucketed by the interval in view, and the lane sparklines are
 * charts on the screen.
 */
export function aggregateLaneTrend(
  points: Array<{ day: string; value: number | null }>,
  interval: TimeInterval,
): Array<{ day: string; value: number | null }> {
  const totals = new Map<string, number | null>();
  for (const point of points) {
    const start = bucketStartOf(point.day, interval);
    if (point.value === null) {
      if (!totals.has(start)) totals.set(start, null);
      continue;
    }
    totals.set(start, (totals.get(start) ?? 0) + point.value);
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, value]) => ({ day, value }));
}
