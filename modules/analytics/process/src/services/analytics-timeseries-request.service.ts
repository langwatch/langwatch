import {
  analyticsMetricAggregations,
  type AnalyticsTimeseriesInput,
} from "@langwatch/analytics-contract";
import { ValidationError } from "@langwatch/handled-error";
import {
  addDays,
  differenceInCalendarDays,
  fromDate,
  Temporal,
  type Instant,
} from "@langwatch/time";

const MINUTES_PER_DAY = 24 * 60;
const MAX_TIMESERIES_BUCKETS = 1000;
const MS_PER_MINUTE = 60_000;

/** The window, scale and series a timeseries request reads, checked before any read. */
export type AnalyticsTimeseriesWindow = {
  readonly input: AnalyticsTimeseriesInput;
  readonly startDate: Instant;
  readonly endDate: Instant;
  readonly previousPeriodStartDate: Instant;
  readonly adjustedTimeScale: number | "full";
};

/** Turns a parsed timeseries request into what the repository reads. Pure arithmetic. */
export class AnalyticsTimeseriesRequestService {
  static create(): AnalyticsTimeseriesRequestService {
    return new AnalyticsTimeseriesRequestService();
  }

  private constructor() {}

  /** Refused before any cache or repository read; ClickHouse would crash on the SQL (#8009). */
  refuseDisallowedAggregations(input: AnalyticsTimeseriesInput): void {
    for (const [index, series] of input.series.entries()) {
      const allowedAggregations = analyticsMetricAggregations[series.metric];
      if (!allowedAggregations) {
        throw new ValidationError("Unknown analytics metric", {
          meta: {
            fieldErrors: {
              [`series.${index}.metric`]: [
                "This metric is not one of the supported analytics metrics.",
              ],
            },
          },
        });
      }
      if (!allowedAggregations.includes(series.aggregation)) {
        throw new ValidationError(
          `Metric "${series.metric}" does not support aggregation "${series.aggregation}" ` +
            `(allowed: ${allowedAggregations.join(", ")})`,
          {
            meta: {
              metric: series.metric,
              aggregation: series.aggregation,
              allowedAggregations,
              fieldErrors: {
                [`series.${index}.aggregation`]: ["This metric does not support this aggregation."],
              },
            },
          },
        );
      }
    }
  }

  windowOf(parsed: AnalyticsTimeseriesInput): AnalyticsTimeseriesWindow {
    const startDate = Temporal.Instant.fromEpochMilliseconds(parsed.startDate);
    const endDate = Temporal.Instant.fromEpochMilliseconds(parsed.endDate);
    return {
      input: withoutEmptySeriesKeys(parsed),
      startDate,
      endDate,
      previousPeriodStartDate: previousPeriodStart({
        startDate,
        endDate,
        period: typeof parsed.timeScale === "number" ? parsed.timeScale : undefined,
        shouldSkipPreviousPeriod: parsed.shouldSkipPreviousPeriod,
      }),
      adjustedTimeScale: adjustTimeScaleForBucketCap({
        timeScale: parsed.timeScale,
        startDate,
        endDate,
      }),
    };
  }
}

function previousPeriodStart({
  startDate,
  endDate,
  period,
  shouldSkipPreviousPeriod,
}: {
  startDate: Instant;
  endDate: Instant;
  period?: number;
  shouldSkipPreviousPeriod?: boolean;
}): Instant {
  // Whole days, always: the scale arrives in minutes and a sub-day scale is a
  // fraction of one, which Temporal refuses outright rather than truncating the
  // way the retired library did.
  const periodInDays = period === undefined ? 1 : Math.ceil(period / MINUTES_PER_DAY);
  const days = Math.max(
    periodInDays,
    differenceInCalendarDays(endDate.epochMilliseconds, startDate.epochMilliseconds) + 1,
  );
  // Skipping collapses the previous window to [startDate, startDate): it matches no row.
  return shouldSkipPreviousPeriod
    ? startDate
    : fromDate(addDays(startDate.epochMilliseconds, -days));
}

/**
 * "full" is one bucket for the whole range and passes through; only a numeric
 * scale that would produce more than the cap collapses to daily.
 */
function adjustTimeScaleForBucketCap({
  timeScale,
  startDate,
  endDate,
}: {
  timeScale: number | "full" | undefined;
  startDate: Instant;
  endDate: Instant;
}): number | "full" {
  if (timeScale === undefined) {
    return MINUTES_PER_DAY;
  }

  if (timeScale === "full") {
    return timeScale;
  }

  const estimatedBuckets =
    (endDate.epochMilliseconds - startDate.epochMilliseconds) / MS_PER_MINUTE / timeScale;

  return estimatedBuckets > MAX_TIMESERIES_BUCKETS ? MINUTES_PER_DAY : timeScale;
}

/** An empty series key means "every evaluator / event", like an absent one; routing agrees. */
function withoutEmptySeriesKeys(input: AnalyticsTimeseriesInput): AnalyticsTimeseriesInput {
  if (!input.series.some((s) => s.key === "" || s.subkey === "")) return input;
  return {
    ...input,
    series: input.series.map((s) => ({
      ...s,
      key: s.key === "" ? undefined : s.key,
      subkey: s.subkey === "" ? undefined : s.subkey,
    })),
  };
}
