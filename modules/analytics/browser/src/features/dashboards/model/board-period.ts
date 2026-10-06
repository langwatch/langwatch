/**
 * Pure period maths for the board header control: turning a chosen range and
 * grain into millisecond bounds and a server-legal granularity. No React.
 */

import {
  LWQL_ACCEPTED_GRANULARITY_STEPS,
  LWQL_GRANULARITY_MAX_BUCKETS,
  type LangWatchQLAcceptedGranularityStep,
} from "@langwatch/analytics-contract";

/** "live" is the last hour, rolling, refreshed every minute (dashboards-v2 AC19c). */
export const BOARD_PERIOD_RANGES = ["live", "1h", "24h", "7d", "30d", "90d", "1y"] as const;
export type BoardPeriodRange = (typeof BOARD_PERIOD_RANGES)[number];

export const BOARD_PERIOD_GRAINS = ["auto", "1m", "5m", "1h", "1d", "1w"] as const;
export type BoardPeriodGrain = (typeof BOARD_PERIOD_GRAINS)[number];

/** The one period every widget on a board reads over, in epoch milliseconds, at a legal step. */
export interface BoardPeriod {
  readonly periodStart: number;
  readonly periodEnd: number;
  readonly granularitySeconds: LangWatchQLAcceptedGranularityStep;
}

export const DEFAULT_BOARD_PERIOD_RANGE: BoardPeriodRange = "30d";
export const DEFAULT_BOARD_PERIOD_GRAIN: BoardPeriodGrain = "auto";

const RANGE_MS: Readonly<Record<BoardPeriodRange, number>> = {
  live: 3_600_000,
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  "90d": 90 * 86_400_000,
  "1y": 365 * 86_400_000,
};

/** The seconds each fixed grain asks for. */
const GRAIN_REQUESTED_SECONDS: Readonly<Record<Exclude<BoardPeriodGrain, "auto">, number>> = {
  "1m": 60,
  "5m": 300,
  "1h": 3600,
  "1d": 86_400,
  "1w": 7 * 86_400,
};

/** What "auto" reads a span at: minutes up to an hour, hours up to a day, days up to a month. */
function autoGrain({ spanMs }: { spanMs: number }): Exclude<BoardPeriodGrain, "auto"> {
  if (spanMs <= RANGE_MS["1h"]) return "1m";
  if (spanMs <= RANGE_MS["24h"]) return "1h";
  if (spanMs <= RANGE_MS["30d"]) return "1d";
  return "1w";
}

/** `[periodStart, periodEnd]` in epoch milliseconds for a range ending at `now`. */
export function boardPeriodBounds({ range, now }: { range: BoardPeriodRange; now: number }): {
  periodStart: number;
  periodEnd: number;
} {
  return { periodStart: now - RANGE_MS[range], periodEnd: now };
}

/**
 * The finest accepted step, up to a week, at or above the request that keeps
 * the period within the bucket budget.
 */
function fitGranularity({
  periodStart,
  periodEnd,
  requested,
}: {
  periodStart: number;
  periodEnd: number;
  requested: number;
}): LangWatchQLAcceptedGranularityStep {
  const seconds = Math.max(1, (periodEnd - periodStart) / 1000);
  const fitting = LWQL_ACCEPTED_GRANULARITY_STEPS.find(
    (step) => step >= requested && seconds / step <= LWQL_GRANULARITY_MAX_BUCKETS,
  );
  return fitting ?? LWQL_ACCEPTED_GRANULARITY_STEPS[LWQL_ACCEPTED_GRANULARITY_STEPS.length - 1]!;
}

/**
 * The granularity actually sent to the server. "Auto" picks a grain for the
 * span; a grain too fine for the range widens through {@link fitGranularity}.
 */
export function boardPeriodGranularity({
  grain,
  periodStart,
  periodEnd,
}: {
  grain: BoardPeriodGrain;
  periodStart: number;
  periodEnd: number;
}): LangWatchQLAcceptedGranularityStep {
  const fixed = grain === "auto" ? autoGrain({ spanMs: periodEnd - periodStart }) : grain;
  return fitGranularity({ periodStart, periodEnd, requested: GRAIN_REQUESTED_SECONDS[fixed] });
}

/**
 * Whether the member may pick `grain` for `range`: LangWatchQL accepts the step, and the
 * range stays within the bucket budget at it. "auto" always fits.
 */
export function boardGrainFits({
  range,
  grain,
}: {
  range: BoardPeriodRange;
  grain: BoardPeriodGrain;
}): boolean {
  if (grain === "auto") return true;
  const seconds = GRAIN_REQUESTED_SECONDS[grain];
  const accepted = (LWQL_ACCEPTED_GRANULARITY_STEPS as readonly number[]).includes(seconds);
  return accepted && RANGE_MS[range] / 1000 / seconds <= LWQL_GRANULARITY_MAX_BUCKETS;
}

/** Parses a range from an untrusted string (e.g. a URL query value); falls back to the default. */
export function parseBoardPeriodRange(value: string | undefined): BoardPeriodRange {
  return (BOARD_PERIOD_RANGES as readonly string[]).includes(value ?? "")
    ? (value as BoardPeriodRange)
    : DEFAULT_BOARD_PERIOD_RANGE;
}

/** Parses a grain from an untrusted string (e.g. a URL query value); falls back to the default. */
export function parseBoardPeriodGrain(value: string | undefined): BoardPeriodGrain {
  return (BOARD_PERIOD_GRAINS as readonly string[]).includes(value ?? "")
    ? (value as BoardPeriodGrain)
    : DEFAULT_BOARD_PERIOD_GRAIN;
}
