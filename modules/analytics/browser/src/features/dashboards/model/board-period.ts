/**
 * Pure period maths for the board header control: turning a chosen range and
 * grain into millisecond bounds and a server-legal granularity. No React.
 */

import {
  LWQL_ACCEPTED_GRANULARITY_STEPS,
  LWQL_GRANULARITY_MAX_BUCKETS,
  type LangWatchQLAcceptedGranularityStep,
} from "@langwatch/analytics-contract";
import { format, Temporal } from "@langwatch/time";

/** "live" is the last hour, rolling, refreshed every minute (dashboards-v2 AC19c). */
export const BOARD_PERIOD_PRESETS = ["live", "1h", "24h", "7d", "30d", "90d", "1y"] as const;
export type BoardPeriodPreset = (typeof BOARD_PERIOD_PRESETS)[number];
/** A preset, or "custom": a fixed window from a start to an end (dashboards-v2 AC19e). */
export type BoardPeriodRange = BoardPeriodPreset | "custom";

/** A custom range's start and end, in epoch milliseconds. */
export interface BoardCustomWindow {
  readonly from: number;
  readonly to: number;
}

export const BOARD_PERIOD_GRAINS = ["auto", "1m", "5m", "1h", "1d", "1w"] as const;
export type BoardPeriodGrain = (typeof BOARD_PERIOD_GRAINS)[number];

/** The one period every widget on a board reads over, in epoch milliseconds, at a legal step. */
export interface BoardPeriod {
  readonly periodStart: number;
  readonly periodEnd: number;
  readonly granularitySeconds: LangWatchQLAcceptedGranularityStep;
}

export const DEFAULT_BOARD_PERIOD_RANGE: BoardPeriodPreset = "30d";
export const DEFAULT_BOARD_PERIOD_GRAIN: BoardPeriodGrain = "auto";

const RANGE_MS: Readonly<Record<BoardPeriodPreset, number>> = {
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

const MINUTE_MS = 60_000;

/**
 * Where a board's window ends, on the next whole minute so a render does not refetch: Live
 * rolls with the clock; a fixed range ends at the last refresh, or when it was picked (AC19d).
 */
export function boardWindowEnd({
  range,
  now,
  pickedAt,
  refreshedAt,
}: {
  range: BoardPeriodPreset;
  now: number;
  pickedAt: number;
  refreshedAt?: number;
}): number {
  const end = range === "live" ? now : Math.max(pickedAt, refreshedAt ?? 0);
  return Math.ceil(end / MINUTE_MS) * MINUTE_MS;
}

/** `[periodStart, periodEnd]` in epoch milliseconds for a range ending at `now`. */
export function boardPeriodBounds({ range, now }: { range: BoardPeriodPreset; now: number }): {
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

/** How long a range is: a preset's fixed length, or a custom window's. */
export function boardRangeSpanMs(reading: BoardRangeReading): number {
  return reading.range === "custom"
    ? reading.custom.to - reading.custom.from
    : RANGE_MS[reading.range];
}

/**
 * Whether the member may pick `grain` over a range `spanMs` long: LangWatchQL accepts the
 * step, and the range stays within the bucket budget at it. "auto" always fits.
 */
export function boardGrainFits({
  spanMs,
  grain,
}: {
  spanMs: number;
  grain: BoardPeriodGrain;
}): boolean {
  if (grain === "auto") return true;
  const seconds = GRAIN_REQUESTED_SECONDS[grain];
  const accepted = (LWQL_ACCEPTED_GRANULARITY_STEPS as readonly number[]).includes(seconds);
  return accepted && spanMs / 1000 / seconds <= LWQL_GRANULARITY_MAX_BUCKETS;
}

function epochOf(text: string | undefined): number | undefined {
  if (!text) return void 0;
  try {
    return Temporal.Instant.from(text).epochMilliseconds;
  } catch {
    return void 0;
  }
}

/** A board's range: a preset, or a custom range with its window. */
export type BoardRangeReading =
  | { readonly range: BoardPeriodPreset; readonly custom?: undefined }
  | { readonly range: "custom"; readonly custom: BoardCustomWindow };

/**
 * Reads the address's `range`, `from` and `to` (untrusted). A custom range needs two
 * readable instants, the start first; anything else reads as the default range (AC19g).
 */
export function parseBoardRange({
  range,
  from,
  to,
}: {
  range?: string;
  from?: string;
  to?: string;
}): BoardRangeReading {
  if (range === "custom") {
    const start = epochOf(from);
    const end = epochOf(to);
    if (start !== void 0 && end !== void 0 && start < end) {
      return { range: "custom", custom: { from: start, to: end } };
    }
    return { range: DEFAULT_BOARD_PERIOD_RANGE };
  }
  return {
    range: (BOARD_PERIOD_PRESETS as readonly string[]).includes(range ?? "")
      ? (range as BoardPeriodPreset)
      : DEFAULT_BOARD_PERIOD_RANGE,
  };
}

/** A custom window as the address writes it: ISO instants. */
export function boardCustomQuery({ from, to }: BoardCustomWindow): { from: string; to: string } {
  return {
    from: Temporal.Instant.fromEpochMilliseconds(from).toString(),
    to: Temporal.Instant.fromEpochMilliseconds(to).toString(),
  };
}

/** Refresh re-reads a window only while it ends now or later; a past custom window is done. */
export function boardRefreshApplies({
  custom,
  now,
}: {
  custom?: BoardCustomWindow;
  now: number;
}): boolean {
  return !custom || custom.to >= now;
}

/** A custom window on the pill, in the reader's time zone: "4 Nov - 11 Nov". */
export function boardCustomInShort({ from, to }: BoardCustomWindow): string {
  if (format(from, "yyyy-MM-dd") === format(to, "yyyy-MM-dd")) {
    return `${format(from, "d MMM HH:mm")}-${format(to, "HH:mm")}`;
  }
  return `${format(from, "d MMM")} - ${format(to, "d MMM")}`;
}

/** Parses a grain from an untrusted string (e.g. a URL query value); falls back to the default. */
export function parseBoardPeriodGrain(value: string | undefined): BoardPeriodGrain {
  return (BOARD_PERIOD_GRAINS as readonly string[]).includes(value ?? "")
    ? (value as BoardPeriodGrain)
    : DEFAULT_BOARD_PERIOD_GRAIN;
}

/** Each range as a person says it; Live is the last hour, as its window is. */
const RANGE_WORDS: Readonly<Record<Exclude<BoardPeriodPreset, "live">, string>> = {
  "1h": "the last hour",
  "24h": "the last 24 hours",
  "7d": "the last 7 days",
  "30d": "the last 30 days",
  "90d": "the last 90 days",
  "1y": "the last year",
};

const dayInWords = (epochMs: number) =>
  Temporal.Instant.fromEpochMilliseconds(epochMs)
    .toZonedDateTimeISO("UTC")
    .toPlainDate()
    .toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric" });

/** The board's period as the header reads it ("the last 30 days"), else its first and last day. */
export function boardPeriodInWords({ periodStart, periodEnd }: BoardPeriod): string {
  const span = periodEnd - periodStart;
  const range = (Object.keys(RANGE_WORDS) as (keyof typeof RANGE_WORDS)[]).find(
    (each) => RANGE_MS[each] === span,
  );
  if (range) return RANGE_WORDS[range];
  return `${dayInWords(periodStart)} to ${dayInWords(periodEnd)}`;
}

function instantOf(at: string) {
  try {
    return Temporal.Instant.from(at);
  } catch {
    return void 0;
  }
}

/**
 * A clicked bucket in words: its day, the hour too on an hourly board, or the week it starts.
 * Undefined when `at` is no instant.
 */
export function bucketInWords({
  at,
  granularitySeconds,
}: {
  at: string;
  granularitySeconds: number;
}): string | undefined {
  const instant = instantOf(at);
  if (!instant) return void 0;
  const day = dayInWords(instant.epochMilliseconds);
  if (granularitySeconds >= 604_800) return `the week of ${day}`;
  if (granularitySeconds >= 86_400) return day;
  const time = instant.toZonedDateTimeISO("UTC").toPlainTime().toString().slice(0, 5);
  return `${day} at ${time} UTC`;
}
