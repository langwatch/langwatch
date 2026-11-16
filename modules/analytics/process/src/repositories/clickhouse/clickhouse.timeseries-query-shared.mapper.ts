import type { AnalyticsAggregation } from "@langwatch/analytics-contract";
import {
  type Condition,
  cond,
  type Expression,
  fn,
  param,
  type ProofScope,
} from "@langwatch/clickhouse-client/builder";

import type { TimeseriesQueryInput } from "./clickhouse.aggregation-builder.mapper.ts";

/**
 * Helpers shared by the slim and rollup timeseries reads (ADR-034 Phase 3, ADR-202): the period,
 * the date bucket and the slim aggregates, as builder expressions, so every table buckets alike.
 */

/** A timeseries read: the proof it runs under, the dashboard's query and the statement settings. */
export type TimeseriesRead = {
  scope: ProofScope;
  input: TimeseriesQueryInput;
  settings: Readonly<Record<string, number | string>>;
};

/** A value read out of a deduped row or a bucket; its type is the column's. */
// oxlint-disable-next-line typescript/no-explicit-any -- a carried column's type is the caller's
export type Measure<Tables extends string = string> = Expression<any, Tables>;

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const DAYS_PER_WEEK = 7;
const DAYS_PER_MONTH = 31;

function validateTimeZone(tz: string): string {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** `[start, end)` of one period, in epoch ms. */
const within = <T extends string>(at: Measure<T>, start: Date, end: Date): Condition<T> =>
  cond.and(cond.gte(at, param.epochMs(start.getTime())), cond.lt(at, param.epochMs(end.getTime())));

export const currentPeriod = <T extends string>(
  at: Measure<T>,
  input: TimeseriesQueryInput,
): Condition<T> => within(at, input.startDate, input.endDate);
export const previousPeriod = <T extends string>(
  at: Measure<T>,
  input: TimeseriesQueryInput,
): Condition<T> => within(at, input.previousPeriodStartDate, input.startDate);

/** The row lies in the current or the previous period: the partition-pruning range. */
export function inEitherPeriod<T extends string>(
  at: Measure<T>,
  input: TimeseriesQueryInput,
): Condition<T> {
  return cond.or(currentPeriod(at, input), previousPeriod(at, input));
}

/** `'current'` or `'previous'`; a read keeps only rows {@link inEitherPeriod}. */
export function periodOf<T extends string>(
  at: Measure<T>,
  input: TimeseriesQueryInput,
): Measure<T> {
  return fn.multiIf(
    [[currentPeriod(at, input), param.string("current")]],
    param.string("previous"),
  );
}

/**
 * The date bucket of `at` for a timeScale in minutes, in the dashboard's zone (UTC when the zone
 * is not one). Mirrors the legacy builder so bucket boundaries match trace_summaries.
 */
export function dateBucket<T extends string>(
  at: Measure<T>,
  timeScaleMinutes: number,
  timeZone: string,
): Measure<T> {
  const zone = { timeZone: validateTimeZone(timeZone) };
  if (timeScaleMinutes <= 1) return fn.toStartOfMinute(at, zone);
  if (timeScaleMinutes < MINUTES_PER_DAY) {
    if (timeScaleMinutes % MINUTES_PER_HOUR === 0) {
      return fn.toStartOfInterval(at, { hours: timeScaleMinutes / MINUTES_PER_HOUR }, zone);
    }
    return fn.toStartOfInterval(at, { minutes: timeScaleMinutes }, zone);
  }
  const days = Math.floor(timeScaleMinutes / MINUTES_PER_DAY);
  if (days === 1) return fn.toStartOfDay(at, zone);
  if (days <= DAYS_PER_WEEK) return fn.toStartOfInterval(at, { days }, zone);
  if (days <= DAYS_PER_MONTH) return fn.toStartOfWeek(at, { mode: 1, ...zone });
  return fn.toStartOfMonth(at, zone);
}

/**
 * A slim aggregate. Percentiles use `quantileTDigest`, the legacy builder's estimator for
 * `performance.*` metrics: bounded memory per group, where `quantileExact` keeps every value.
 */
export function slimAggregate<T extends string>({
  aggregation,
  of,
  table,
}: {
  aggregation: AnalyticsAggregation;
  of: Measure<T>;
  table: string;
}): Measure<T> {
  if (isPercentile(aggregation)) return fn.quantileTDigest(percentileFor(aggregation), of);
  switch (aggregation) {
    case "sum":
      // An unsigned zero widens to sum's own type (UInt64, Int64 or Float64), as main's literal 0.
      return fn.coalesce(fn.sum(of), param.uint32(0));
    case "avg":
      return fn.avg(of);
    case "min":
      return fn.min(of);
    case "max":
      return fn.max(of);
    case "cardinality":
    case "terms":
      return fn.uniq(of);
    default:
      throw new Error(`Unhandled ${table} aggregation: ${String(aggregation)}`);
  }
}

/** `cond.and` and `cond.or` over a list, which may hold a single term. */
export const allOf = <T extends string>([first, ...rest]: Condition<T>[]): Condition<T> =>
  first ? cond.and(first, ...rest) : cond.always();
export const anyOf = <T extends string>([first, ...rest]: Condition<T>[]): Condition<T> =>
  first ? cond.or(first, ...rest) : cond.never();

/** `group_key`: NULL reads as `'unknown'`, anything else as its text. */
export function groupKeyOf<T extends string>(of: Measure<T>): Measure<T> {
  return fn.if(cond.isNull(of), param.string("unknown"), fn.toString(of));
}

export function hasFilterValues(
  v: string[] | Record<string, string[]> | Record<string, Record<string, string[]>> | undefined,
): boolean {
  if (v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v !== "object") return false;
  return Object.values(v).some(hasNestedFilterValues);
}

function hasNestedFilterValues(inner: string[] | Record<string, string[]>): boolean {
  if (Array.isArray(inner) && inner.length > 0) {
    return true;
  }
  if (typeof inner !== "object" || inner === null) {
    return false;
  }
  return Object.values(inner).some((value) => Array.isArray(value) && value.length > 0);
}

export function collectStringValues(
  value: string[] | Record<string, string[]> | Record<string, Record<string, string[]>>,
): string[] {
  if (Array.isArray(value)) return value;
  const out: string[] = [];
  for (const inner of Object.values(value)) {
    if (Array.isArray(inner)) {
      out.push(...inner);
      continue;
    }
    if (typeof inner === "object" && inner !== null) {
      for (const v of Object.values(inner)) {
        if (Array.isArray(v)) out.push(...v);
      }
    }
  }
  return out;
}

/**
 * Percentile aggregations recognised by both slim + eval-slim builders.
 * ClickHouse's `quantileExact(<level>)` takes a fraction in [0, 1].
 */
export function isPercentile(agg: "median" | "p90" | "p95" | "p99" | (string & {})): boolean {
  return agg === "median" || agg === "p90" || agg === "p95" || agg === "p99";
}

export function percentileFor(agg: string): number {
  switch (agg) {
    case "median":
      return 0.5;
    case "p90":
      return 0.9;
    case "p95":
      return 0.95;
    case "p99":
      return 0.99;
    default:
      throw new Error(`Not a percentile aggregation: ${agg}`);
  }
}

/**
 * The evaluation metrics both timeseries builders can answer — one list,
 * with the type and runtime check both derived from it. It used to be three
 * hand-written copies; forgetting one meant a metric that routed but refused.
 */
export const EVAL_METRIC_KEYS = [
  "evaluations.evaluation_score",
  "evaluations.evaluation_pass_rate",
  "evaluations.evaluation_runs",
] as const;

export type EvalMetricKey = (typeof EVAL_METRIC_KEYS)[number];

export function isEvalMetricKey(metric: string): metric is EvalMetricKey {
  return (EVAL_METRIC_KEYS as readonly string[]).includes(metric);
}
