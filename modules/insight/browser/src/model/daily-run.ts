/**
 * A board's daily run as its person reads it: the choices a run takes, the words for when it
 * runs and how the last one ended, and when a board offers it. Pure, so the control, the
 * offer and the settings say the same thing.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import {
  DEFAULT_INSIGHT_RUN_MAX_INSIGHTS,
  INSIGHT_RUN_MAX_INSIGHTS_CHOICES,
  INSIGHT_RUN_SKIP_REASONS,
  type InsightDailyRunSetting,
  type InsightRunSettings,
  type InsightRunSkipReason,
  type InsightScheduleState,
} from "@langwatch/insight-contract";
import { differenceInCalendarDays, format, toZonedDateTime } from "@langwatch/time";

export type InsightLastRun = NonNullable<InsightDailyRunSetting["lastRun"]>;

/** Every hour of the day; a run starts at a minute within the one chosen. */
export const RUN_HOURS: readonly number[] = Array.from({ length: 24 }, (_, hour) => hour);

/** The start of a working day where the reader is. */
const DEFAULT_RUN_HOUR = 9;

/** Few on purpose: a run that files many is a feed nobody reads. */
export const RUN_MAXIMUMS = INSIGHT_RUN_MAX_INSIGHTS_CHOICES;

/** The zones offered beside the reader's own, west to east: a list a person can scan. */
const COMMON_ZONES = [
  "America/Los_Angeles",
  "America/New_York",
  "America/Sao_Paulo",
  "UTC",
  "Europe/London",
  "Europe/Amsterdam",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;

/** What a board starts with when it is turned on for the first time. */
export function defaultRunSettings({ timezone }: { timezone: string }): InsightRunSettings {
  return {
    hour: DEFAULT_RUN_HOUR,
    timezone,
    maxInsights: DEFAULT_INSIGHT_RUN_MAX_INSIGHTS,
  };
}

/** A maximum the schedule takes, or the default for a value it does not. */
export function runMaximum(value: number): InsightRunSettings["maxInsights"] {
  return RUN_MAXIMUMS.find((maximum) => maximum === value) ?? DEFAULT_INSIGHT_RUN_MAX_INSIGHTS;
}

/** "09:00": the hour as a clock shows it. */
export function hourWords(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** "Amsterdam time", from "Europe/Amsterdam"; UTC is its own name. */
function zoneName(zone: string): string {
  const place = zone.slice(zone.lastIndexOf("/") + 1).replaceAll("_", " ");
  return place === "UTC" || place === "GMT" ? "UTC" : `${place} time`;
}

/** "UTC+2", "UTC-7", "UTC+5:30": the zone's offset at one moment. */
function zoneOffset({ zone, now }: { zone: string; now: number }): string {
  const [hours = "", minutes = "00"] = toZonedDateTime(now, { timeZone: zone }).offset.split(":");
  const whole = `${hours.slice(0, 1)}${Number(hours.slice(1))}`;
  return `UTC${whole}${minutes === "00" ? "" : `:${minutes}`}`;
}

/** "Amsterdam time (UTC+2)": a zone as the picker lists it. */
export function zoneLabel({ zone, now }: { zone: string; now: number }): string {
  const name = zoneName(zone);
  return name === "UTC" ? name : `${name} (${zoneOffset({ zone, now })})`;
}

/** The reader's own zone and the common ones; a run set to any other zone keeps it listed. */
export function zoneChoices({ own, current }: { own: string; current: string }): {
  own: string;
  others: string[];
} {
  const others: string[] = COMMON_ZONES.filter((zone) => zone !== own);
  if (current !== own && !others.includes(current)) others.unshift(current);
  return { own, others };
}

/** "around 09:00 Amsterdam time": a run starts at a minute within its hour, so never "at". */
export function runTimeWords({ hour, timezone }: Pick<InsightRunSettings, "hour" | "timezone">) {
  return `around ${hourWords(hour)} ${zoneName(timezone)}`;
}

/** The sentence under the control's title: when the run reads the board and how much it files. */
export function scheduleWords({
  settings,
  hasWidgets,
}: {
  settings: InsightRunSettings;
  hasWidgets: boolean;
}): string {
  if (!hasWidgets) {
    return "This board has no widgets, so Langy has nothing to read. Add a widget and the next run reads it.";
  }
  const most = settings.maxInsights === 1 ? "1 insight" : `${settings.maxInsights} insights`;
  return `Langy reads this board for you every day ${runTimeWords(settings)} and files what stands out, at most ${most} per run.`;
}

/** Why a run never reached Langy, in a person's words. One per reason the contract lists. */
export const SKIP_REASON_WORDS: Record<InsightRunSkipReason, string> = {
  flag_off: "Insights is off for this project",
  project_unavailable: "this project takes no daily runs",
  user_missing: "your account was not found",
  no_access: "you do not have access to analytics in this project",
  langy_off: "Langy is not available to you in this project",
  board_deleted: "this board could not be found",
  board_unreadable: "this board cannot be read in this project",
  board_empty: "this board had no widgets Langy can read",
  template_board: "Langy cannot read From LangWatch boards yet",
};

/** "09:12" for a run today, "Oct 3" for an earlier one, read in the run's own zone. */
function runWhen({ at, now, timezone }: { at: number; now: number; timezone: string }): string {
  const zone = { timeZone: timezone };
  return differenceInCalendarDays(now, at, zone) === 0
    ? format(at, "HH:mm", zone)
    : format(at, "MMM d", zone);
}

/**
 * The line under the schedule: what the last run did. A run that never reached Langy says
 * "Did not run" and why, so an empty inbox is an answer and not a question.
 */
export function lastRunWords({
  lastRun,
  now,
  timezone,
}: {
  lastRun: InsightLastRun | null;
  now: number;
  /** The zone the run is set to, so its time reads beside its hour. */
  timezone: string;
}): string {
  if (!lastRun) return "No run yet.";
  const when = runWhen({ at: lastRun.at, now, timezone });
  if (lastRun.outcome === "filed") return `Ran ${when} · filed ${lastRun.filedCount} new`;
  if (lastRun.outcome === "nothing") return `Ran ${when} · nothing new`;
  if (lastRun.outcome === "failed") {
    return `Failed ${when} · nothing was filed, and the next run tries again`;
  }
  const reason = INSIGHT_RUN_SKIP_REASONS.find((known) => known === lastRun.reason);
  return `Did not run ${when} · ${reason ? SKIP_REASON_WORDS[reason] : "nothing was filed"}`;
}

/**
 * Whether a board offers daily insights now. Today: once per visit, to a person who never
 * answered, on a board that opened with a widget. An answer is the server's `on` or `off`,
 * so nothing is kept in the browser. How often the offer shows is decided here alone.
 */
export function shouldOfferDailyInsights({
  state,
  widgetCountAtOpen,
  closedThisVisit,
}: {
  state: InsightScheduleState;
  /** The board's widgets when the visit began; undefined while they load. */
  widgetCountAtOpen: number | undefined;
  /** The offer was closed without an answer during this visit. */
  closedThisVisit: boolean;
}): boolean {
  return state === "undecided" && (widgetCountAtOpen ?? 0) > 0 && !closedThisVisit;
}

/** Said before a person turns a From LangWatch board on: no run can read one yet. */
export const TEMPLATE_BOARD_NOTE =
  "Langy cannot read From LangWatch boards yet. Until it can, a run on this board files nothing.";
