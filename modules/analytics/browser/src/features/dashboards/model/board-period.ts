/**
 * Pure period maths for the board header control: turning a chosen range and
 * grain into millisecond bounds and a server-legal granularity. No React.
 */

import {
  LWQL_GRANULARITY_STEPS,
  type LangWatchQLGranularityStep,
} from "@langwatch/analytics-contract";

import { fitGranularity } from "../blocks/index.ts";

export const BOARD_PERIOD_RANGES = ["1h", "24h", "7d", "30d", "90d", "1y"] as const;
export type BoardPeriodRange = (typeof BOARD_PERIOD_RANGES)[number];

export const BOARD_PERIOD_GRAINS = ["auto", "1h", "1d", "1w"] as const;
export type BoardPeriodGrain = (typeof BOARD_PERIOD_GRAINS)[number];

export const DEFAULT_BOARD_PERIOD_RANGE: BoardPeriodRange = "30d";
export const DEFAULT_BOARD_PERIOD_GRAIN: BoardPeriodGrain = "auto";

const RANGE_MS: Readonly<Record<BoardPeriodRange, number>> = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  "90d": 90 * 86_400_000,
  "1y": 365 * 86_400_000,
};

/** The seconds each fixed grain asks for; "auto" has none, it asks for the finest step. */
const GRAIN_REQUESTED_SECONDS: Readonly<Record<Exclude<BoardPeriodGrain, "auto">, number>> = {
  "1h": 3600,
  "1d": 86_400,
  "1w": 7 * 86_400,
};

/** Whether the server has this exact step today, so the menu can grey it out. */
export function boardPeriodGrainIsSupported(grain: Exclude<BoardPeriodGrain, "auto">): boolean {
  return (LWQL_GRANULARITY_STEPS as readonly number[]).includes(GRAIN_REQUESTED_SECONDS[grain]);
}

/** `[periodStart, periodEnd]` in epoch milliseconds for a range ending at `now`. */
export function boardPeriodBounds({ range, now }: { range: BoardPeriodRange; now: number }): {
  periodStart: number;
  periodEnd: number;
} {
  return { periodStart: now - RANGE_MS[range], periodEnd: now };
}

/**
 * The granularity actually sent to the server. "Auto" asks for the finest
 * offered step and lets {@link fitGranularity} widen it to the bucket budget;
 * a fixed grain the server cannot take today widens the same way.
 */
export function boardPeriodGranularity({
  grain,
  periodStart,
  periodEnd,
}: {
  grain: BoardPeriodGrain;
  periodStart: number;
  periodEnd: number;
}): LangWatchQLGranularityStep {
  const requested = grain === "auto" ? LWQL_GRANULARITY_STEPS[0] : GRAIN_REQUESTED_SECONDS[grain];
  return fitGranularity({ periodStart, periodEnd, requested });
}

/** The label the header button shows, e.g. "30d · auto". */
export function boardPeriodLabel({
  range,
  grain,
}: {
  range: BoardPeriodRange;
  grain: BoardPeriodGrain;
}): string {
  return `${range} · ${grain}`;
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
