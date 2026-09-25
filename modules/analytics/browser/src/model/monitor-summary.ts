import type { AnalyticsTimeseriesResult } from "@langwatch/analytics-contract";
import type { RotatingColorSet } from "@langwatch/design-system/rotating-colors";
import { format } from "@langwatch/time";

type MonitorRow = Readonly<Record<string, number>>;

export type MonitorSummary = {
  isPassRate: boolean;
  summaryValue: number | undefined;
  hasData: boolean;
  hasLoaded: boolean;
  colorSet: RotatingColorSet;
  scoreLabel: string;
  maxValue: number;
};

const DAY_MS = 1000 * 60 * 60 * 24;

/**
 * The monitor card's headline: the run-weighted full-period value, falling back to the
 * average of the real daily values only when the full-period read errored.
 */
export function summarizeMonitor({
  seriesKey,
  data,
  filledData,
  summary,
  disabled,
}: {
  seriesKey: string;
  data: readonly MonitorRow[] | undefined;
  filledData: readonly MonitorRow[] | undefined;
  summary: { data: AnalyticsTimeseriesResult | undefined; isError: boolean };
  disabled: boolean;
}): MonitorSummary {
  const isPassRate = seriesKey.includes("pass_rate");
  const allValues = seriesValues(isPassRate ? filledData : data, seriesKey);
  const summaryRaw = summary.data?.currentPeriod?.[0]?.[seriesKey];
  const fallbackValue = summary.isError ? average(seriesValues(data, seriesKey)) : undefined;
  const summaryValue = typeof summaryRaw === "number" ? summaryRaw : fallbackValue;
  const hasLoaded =
    filledData?.length !== undefined && (summary.data !== undefined || summary.isError);
  const finiteValues = allValues && allValues.length > 0 ? allValues.filter(Number.isFinite) : [];
  const observedMax = finiteValues.length > 0 ? Math.max(...finiteValues) : 1;

  return {
    isPassRate,
    summaryValue,
    hasData: summaryValue !== undefined,
    hasLoaded,
    colorSet: disabled ? "grayTones" : healthColorSet({ summaryValue, hasLoaded }),
    scoreLabel: isPassRate ? "Pass Rate" : "Average Score",
    maxValue: isPassRate ? 1 : observedMax,
  };
}

/** "Last N days" when the period ends within a day of now, else the date range. */
export function monitorPeriodLabel({
  startDate,
  endDate,
  now,
}: {
  startDate: number;
  endDate: number;
  now: number;
}): string {
  const daysDiff = Math.abs(Math.ceil((now - endDate) / DAY_MS));
  const periodDays = Math.ceil((endDate - startDate) / DAY_MS);
  if (daysDiff <= 1) return `Last ${periodDays} days`;
  return `${format(startDate, "MMM d")} - ${format(endDate, "MMM d, yyyy")}`;
}

function seriesValues(rows: readonly MonitorRow[] | undefined, key: string): number[] | undefined {
  return rows?.map((entry) => entry[key]!).filter((x) => x !== undefined && x !== null);
}

function average(values: number[] | undefined): number | undefined {
  if (!values || values.length === 0) return undefined;
  return values.reduce((acc, curr) => acc + curr, 0) / values.length;
}

/** Healthy above 0.8 (or while unknown), orange below, red under 0.4; thresholds are fixed. */
function healthColorSet({
  summaryValue,
  hasLoaded,
}: {
  summaryValue: number | undefined;
  hasLoaded: boolean;
}): RotatingColorSet {
  if (summaryValue === undefined || summaryValue > 0.8 || !hasLoaded) return "greenTones";
  return summaryValue < 0.4 ? "redTones" : "orangeTones";
}
