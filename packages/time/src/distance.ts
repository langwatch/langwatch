/**
 * Relative time in words: rounded ("about 3 hours ago"), strict ("3 hours
 * ago") and compact, the shape a table row prints ("3h ago"). The tests pin
 * every rung of each ladder against the wording the screens showed.
 */

import {
  compareMoments,
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  differenceInMonths,
  differenceInMilliseconds,
  differenceInWeeks,
  wallClockSecondsBetween,
} from "./difference.ts";
import type { TimeInput, ZoneOptions } from "./zoned.ts";

const MINUTES_IN_DAY = 1440;
const MINUTES_IN_ALMOST_TWO_DAYS = 2520;
const MINUTES_IN_MONTH = 43_200;
const MINUTES_IN_YEAR = 525_600;

const WORDING = {
  xSeconds: { one: "1 second", other: "{{count}} seconds" },
  lessThanXMinutes: { one: "less than a minute", other: "less than {{count}} minutes" },
  xMinutes: { one: "1 minute", other: "{{count}} minutes" },
  aboutXHours: { one: "about 1 hour", other: "about {{count}} hours" },
  xHours: { one: "1 hour", other: "{{count}} hours" },
  xDays: { one: "1 day", other: "{{count}} days" },
  aboutXMonths: { one: "about 1 month", other: "about {{count}} months" },
  xMonths: { one: "1 month", other: "{{count}} months" },
  aboutXYears: { one: "about 1 year", other: "about {{count}} years" },
  xYears: { one: "1 year", other: "{{count}} years" },
  overXYears: { one: "over 1 year", other: "over {{count}} years" },
  almostXYears: { one: "almost 1 year", other: "almost {{count}} years" },
} as const;

type Wording = keyof typeof WORDING;

export interface DistanceOptions extends ZoneOptions {
  /** Reads "in 3 hours" ahead of the moment and "3 hours ago" behind it. */
  addSuffix?: boolean;
}

function say(
  token: Wording,
  count: number,
  { addSuffix, comparison }: { addSuffix?: boolean; comparison: number },
): string {
  const shape = WORDING[token];
  const result = count === 1 ? shape.one : shape.other.replace("{{count}}", String(count));
  if (!addSuffix) return result;
  return comparison > 0 ? `in ${result}` : `${result} ago`;
}

/**
 * The rounded wording: "less than a minute", "about 3 hours", "2 days".
 */
export function formatDistance(
  later: TimeInput,
  earlier: TimeInput,
  options?: DistanceOptions,
): string {
  const comparison = compareMoments(later, earlier);
  const [from, to] = comparison > 0 ? [earlier, later] : [later, earlier];
  const suffix = { addSuffix: options?.addSuffix, comparison };

  const seconds = Math.trunc(Math.abs(wallClockSecondsBetween(to, from, options)));
  const minutes = Math.round(seconds / 60);

  if (minutes < 2) {
    return minutes === 0 ? say("lessThanXMinutes", 1, suffix) : say("xMinutes", minutes, suffix);
  }
  if (minutes < 45) return say("xMinutes", minutes, suffix);
  if (minutes < 90) return say("aboutXHours", 1, suffix);
  if (minutes < MINUTES_IN_DAY) return say("aboutXHours", Math.round(minutes / 60), suffix);
  if (minutes < MINUTES_IN_ALMOST_TWO_DAYS) return say("xDays", 1, suffix);
  if (minutes < MINUTES_IN_MONTH) {
    return say("xDays", Math.round(minutes / MINUTES_IN_DAY), suffix);
  }
  if (minutes < MINUTES_IN_MONTH * 2) {
    return say("aboutXMonths", Math.round(minutes / MINUTES_IN_MONTH), suffix);
  }

  const months = Math.abs(differenceInMonths(to, from, options));
  if (months < 12) {
    return say("xMonths", Math.round(minutes / MINUTES_IN_MONTH), suffix);
  }

  const monthsThisYear = months % 12;
  const years = Math.trunc(months / 12);
  if (monthsThisYear < 3) return say("aboutXYears", years, suffix);
  if (monthsThisYear < 9) return say("overXYears", years, suffix);
  return say("almostXYears", years + 1, suffix);
}

/** The rounded wording, read against right now. */
export function formatDistanceToNow(value: TimeInput, options?: DistanceOptions): string {
  return formatDistance(value, Date.now(), options);
}

/**
 * The strict wording: one unit, rounded, with no "about". "45 seconds",
 * "3 hours", "2 months".
 */
export function formatDistanceStrict(
  later: TimeInput,
  earlier: TimeInput,
  options?: DistanceOptions,
): string {
  const comparison = compareMoments(later, earlier);
  const [from, to] = comparison > 0 ? [earlier, later] : [later, earlier];
  const suffix = { addSuffix: options?.addSuffix, comparison };

  const milliseconds = Math.abs(differenceInMilliseconds(to, from));
  const minutes = milliseconds / 60_000;
  const wallMinutes = Math.abs(wallClockSecondsBetween(to, from, options)) / 60;

  if (minutes < 1) return say("xSeconds", Math.round(milliseconds / 1000), suffix);
  if (minutes < 60) return say("xMinutes", Math.round(minutes), suffix);
  if (minutes < MINUTES_IN_DAY) return say("xHours", Math.round(minutes / 60), suffix);
  if (wallMinutes < MINUTES_IN_MONTH) {
    return say("xDays", Math.round(wallMinutes / MINUTES_IN_DAY), suffix);
  }
  if (wallMinutes < MINUTES_IN_YEAR) {
    const months = Math.round(wallMinutes / MINUTES_IN_MONTH);
    return months === 12 ? say("xYears", 1, suffix) : say("xMonths", months, suffix);
  }
  return say("xYears", Math.round(wallMinutes / MINUTES_IN_YEAR), suffix);
}

/**
 * The compact wording a table row prints: one abbreviated unit and always
 * "ago" — "now", "5m ago", "3h ago", "2d ago", "1w ago", "3mo ago". There is
 * no future form because a table row never shows one. Months are simple
 * 30-day months (not calendar months), matching the product's own ladder.
 */
export function formatDistanceCompact(
  later: TimeInput,
  earlier: TimeInput,
  options?: ZoneOptions,
): string {
  const minutes = Math.abs(differenceInMinutes(later, earlier));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.abs(differenceInHours(later, earlier));
  if (hours < 24) return `${hours}h ago`;

  const days = Math.abs(differenceInDays(later, earlier, options));
  if (days < 7) return `${days}d ago`;

  const weeks = Math.abs(differenceInWeeks(later, earlier, options));
  if (days < 30) return `${weeks}w ago`;

  return `${Math.floor(days / 30)}mo ago`;
}
