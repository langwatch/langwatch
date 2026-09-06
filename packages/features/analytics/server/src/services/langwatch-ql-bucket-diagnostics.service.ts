/**
 * The time-bucket rules: whether the periods a bucketed answer compares cover
 * the same span, and whether any bucket is missing from the axis.
 */
import type { LangWatchQLDiagnostic } from "@langwatch/analytics-contract";

import type { LangWatchQLDiagnosticsInput } from "../rules/langwatch-ql-diagnostics-shape.rules.ts";

/**
 * Buckets needed before a gap can be told from the spacing. Two buckets one hour apart are
 * indistinguishable from two hourly buckets with an hour missing between them, so the gap rule
 * needs a third.
 */
const MIN_BUCKETS_FOR_GAP_DETECTION = 3;

/**
 * How far a spacing may drift from a whole multiple of the bucket width, per bucket the spacing
 * covers, and still count as aligned.
 */
const BUCKET_ALIGNMENT_TOLERANCE = 0.15;

function timeBucketDiagnostics(input: LangWatchQLDiagnosticsInput): LangWatchQLDiagnostic[] {
  const axis = timeBucketAxis(input);
  if (!axis) {
    return [];
  }

  const { column, buckets } = axis;
  const width = Math.min(...buckets.slice(1).map((value, index) => value - buckets[index]!));
  if (!Number.isFinite(width) || width <= 0) {
    return [];
  }

  return [
    ...comparisonPeriodDiagnostics({ column, buckets, width, now: input.now }),
    ...missingBucketDiagnostics({ column, buckets, width }),
  ];
}

/**
 * The result's time axis, or nothing when the query has none.
 */
function timeBucketAxis({
  validation,
  columns,
  rows,
}: LangWatchQLDiagnosticsInput): { column: string; buckets: number[] } | null {
  const temporal = columns.filter((column) => isTemporalType(column.type));
  const [column] = temporal;
  if (temporal.length !== 1 || !column) {
    return null;
  }

  const grouped = new Set(validation.blocks.flatMap((block) => block.groupByColumns));
  if (!grouped.has(column.name.trim().toLowerCase())) {
    return null;
  }

  const buckets = [
    ...new Set(
      rows
        .map((row) => parseClickHouseTimestamp(row[column.name]))
        .filter((value): value is number => value !== null),
    ),
  ].sort((left, right) => left - right);

  return buckets.length >= 2 ? { column: column.name, buckets } : null;
}

function comparisonPeriodDiagnostics({
  column,
  buckets,
  width,
  now,
}: {
  column: string;
  buckets: readonly number[];
  width: number;
  now: Date;
}): LangWatchQLDiagnostic[] {
  const misaligned = buckets
    .slice(1)
    .map((value, index) => value - buckets[index]!)
    .filter((gap) => !isWholeMultiple(gap, width));
  const newest = buckets.at(-1)!;
  const unfinished = newest + width > now.getTime();

  if (misaligned.length === 0 && !unfinished) {
    return [];
  }

  return [
    {
      code: "INCOMPLETE_COMPARISON_PERIOD",
      message: unfinished
        ? `The newest ${column} period has not finished yet, so it holds less data than the ones ` +
          `before it. Comparing it with an earlier period compares unequal spans of time — end ` +
          `the range at the last completed period instead.`
        : `The ${column} periods are not all the same length, so comparing them compares unequal ` +
          `spans of time. Bucket the range into equal periods, or compare only periods of the ` +
          `same length.`,
      meta: {
        timeColumn: column,
        /** Why the periods do not compare: one is still filling, or they differ in length. */
        reason: unfinished ? "unfinished_newest_period" : "unequal_periods",
        /** The period length the rest of the result is bucketed at, in milliseconds. */
        periodMs: width,
        /** Start of the newest period, as the result reported it. */
        newestPeriodStart: new Date(newest).toISOString(),
        /** How many gaps between periods are not a whole number of periods. */
        unevenPeriodCount: misaligned.length,
      },
    },
  ];
}

function missingBucketDiagnostics({
  column,
  buckets,
  width,
}: {
  column: string;
  buckets: readonly number[];
  width: number;
}): LangWatchQLDiagnostic[] {
  if (buckets.length < MIN_BUCKETS_FOR_GAP_DETECTION) {
    return [];
  }

  let missing = 0;
  const gapsAfter: string[] = [];
  buckets.slice(1).forEach((value, index) => {
    const previous = buckets[index]!;
    const gap = value - previous;
    if (!isWholeMultiple(gap, width)) {
      return;
    }

    const skipped = Math.round(gap / width) - 1;
    if (skipped <= 0) {
      return;
    }

    missing += skipped;
    gapsAfter.push(new Date(previous).toISOString());
  });
  if (missing === 0) {
    return [];
  }

  return [
    {
      code: "MISSING_TIME_BUCKETS",
      message:
        `${missing} ${column} bucket${missing === 1 ? "" : "s"} inside the range have no rows, ` +
        `so the answer has holes rather than zeros. A bucket with no matching row is absent from ` +
        `a grouped result — fill the gaps on your side if the series has to be continuous.`,
      meta: {
        timeColumn: column,
        /** How many bucket positions inside the range carry no row. */
        missingBucketCount: missing,
        /** The bucket width the gaps are counted against, in milliseconds. */
        bucketMs: width,
        /** The buckets a gap follows, so a consumer can find the holes. */
        gapsAfter,
      },
    },
  ];
}

/** Whether `value` is a whole number of `unit`s, within the calendar tolerance. */
function isWholeMultiple(value: number, unit: number): boolean {
  const multiple = value / unit;
  const nearest = Math.round(multiple);

  // Scaled by the buckets the gap covers, not fixed: a three-month hole drifts roughly three
  // times as far from a whole multiple of the shortest month as a one-month step does. Judged
  // against a fixed budget it reads as "these periods are unequal lengths" while the truth is
  // "two months are missing" — and `missingBucketDiagnostics` skips the same gap, so the count
  // of absent buckets comes back zero.
  return Math.abs(multiple - nearest) <= BUCKET_ALIGNMENT_TOLERANCE * Math.max(1, nearest);
}

// ---------------------------------------------------------------------------
// Reading the server's temporal values
// ---------------------------------------------------------------------------

/** Wrappers that carry a temporal type without changing that it is one. */
const TYPE_WRAPPER = /^(?:Nullable|LowCardinality)\((.*)\)$/;

/** How many wrappers are unwrapped before giving up. `Nullable(LowCardinality(…))`. */
const MAX_TYPE_WRAPPERS = 3;

/** Whether a ClickHouse type names a point in time. */
function isTemporalType(type: string): boolean {
  let inner = type.trim();
  for (let pass = 0; pass < MAX_TYPE_WRAPPERS; pass += 1) {
    const match = TYPE_WRAPPER.exec(inner);
    if (!match?.[1]) {
      break;
    }

    inner = match[1].trim();
  }

  return /^Date(?:32)?$/.test(inner) || /^DateTime(?:64)?\b/.test(inner);
}

/** `2026-02-20`, `2026-02-20 12:00:00`, `2026-02-20 12:00:00.000`. */
const CLICKHOUSE_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?))?$/;

/**
 * A temporal value as milliseconds, or `null` for anything else. Read as UTC rather than
 * through `new Date(string)`, which interprets a space-separated timestamp in the *server
 * process's* zone — so the same result would produce different diagnostics on two deployments.
 */
function parseClickHouseTimestamp(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = CLICKHOUSE_TIMESTAMP.exec(value.trim());
  if (!match?.[1]) {
    return null;
  }

  const parsed = Date.parse(`${match[1]}T${match[2] ?? "00:00:00"}Z`);

  return Number.isNaN(parsed) ? null : parsed;
}

/** Reports what a time-bucketed answer's own axis says about its coverage. */
export class LangWatchQLBucketDiagnosticsService {
  static create(): LangWatchQLBucketDiagnosticsService {
    return new LangWatchQLBucketDiagnosticsService();
  }

  private constructor() {}

  diagnose(input: LangWatchQLDiagnosticsInput): readonly LangWatchQLDiagnostic[] {
    return timeBucketDiagnostics(input);
  }
}
