// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Cron } from "croner";
import {
  timeOfDay,
  WEEKDAYS,
} from "~/features/automations/logic/reportSchedule";
import type { SourceType } from "../components/ingestionSourceCatalog";

/**
 * Pure cadence <-> cron helpers for the pull-source Cadence picker. Kept out
 * of the React component so the round-trip (friendly picker -> cron ->
 * friendly picker) is unit-testable as plain functions.
 *
 * This is deliberately NOT the automations reportSchedule parts model: the
 * pull adapters' recommended schedules are step ("*\/15 * * * *") and hourly
 * ("0 * * * *") crons, which `partsFromCron` over there rejects by design (a
 * report every 15 minutes is 96 emails a day). Pull sources poll; sub-daily
 * is their normal, so this model speaks four shapes:
 *   minutes  `*\/N * * * *`   (N from MINUTE_INTERVALS)
 *   hourly   `m * * * *`
 *   daily    `m h * * *`
 *   weekly   `m h * * D`     (D = 0-6, 0 = Sunday)
 * Anything else is "custom" — `partsFromPullCron` returns null so the field
 * can drop into the raw-cron editor without losing the value.
 *
 * Schedules run in UTC — the scheduler stores a bare cron with no timezone,
 * so offering a timezone picker here would promise something the backend
 * does not keep.
 */

export type PullFrequency = "minutes" | "hourly" | "daily" | "weekly";

export interface PullCadenceParts {
  frequency: PullFrequency;
  /** Interval for the minutes frequency; one of MINUTE_INTERVALS. */
  everyMinutes: number;
  /** 0-59. Meaningful for hourly, daily, and weekly. */
  minute: number;
  /** 0-23. Meaningful for daily and weekly. */
  hour: number;
  /** cron day-of-week, 0-6 (0 = Sunday). Meaningful for weekly. */
  dayOfWeek: number;
}

/** The step intervals the picker offers. Only these parse back, so adding
 *  one here is all it takes to offer it. */
export const MINUTE_INTERVALS = [5, 10, 15, 30] as const;

/**
 * Maps user-facing pull-mode source-types onto the PullerAdapter id
 * registered server-side (`pullerAdapterRegistry.ids()`). A hardcoded
 * curated list - keeps the UI free of a round-trip enumeration call;
 * entries land in lockstep with the reference adapters in
 * `services/pullers/`. Lives here (not in the page) so the Cadence field
 * can resolve a source's recommended schedule without importing the page
 * it is rendered by.
 */
export const PULL_ADAPTER_FOR_SOURCE: Partial<Record<SourceType, string>> = {
  // Retired, but kept: rows configured on it still need a cadence resolved.
  copilot_studio: "copilot_studio",
  copilot_studio_dataverse: "copilot_studio_dataverse",
  openai_compliance: "openai_compliance",
  openai_admin: "openai_admin",
  claude_compliance: "claude_compliance",
  anthropic_admin: "anthropic_admin",
  databricks_genie: "databricks_genie",
  http_custom: "http_polling",
};

/**
 * Recommended cron schedule per puller adapter - mirrors the locked
 * `*_PULL_CONFIG.schedule` from the reference impl. Keeps the UI in
 * sync without a server round-trip; if the locked default ever
 * diverges, update both ends.
 */
export const PULL_SCHEDULE_DEFAULTS: Record<string, string> = {
  copilot_studio: "*/15 * * * *",
  // Dataverse writes a transcript roughly half an hour after the conversation
  // ends, so a shorter cadence than this buys nothing; a longer one only adds
  // to a delay the customer already feels.
  copilot_studio_dataverse: "*/15 * * * *",
  openai_compliance: "*/15 * * * *",
  // Hourly. The report is bucketed by day, so finer polling reads the same
  // bucket over and over for nothing.
  openai_admin: "0 * * * *",
  claude_compliance: "*/15 * * * *",
  anthropic_admin: "0 * * * *",
  databricks_genie: "*/15 * * * *",
  http_polling: "*/15 * * * *",
};

/**
 * How many months of history a NEWLY added source proposes to read, per source
 * type.
 *
 * A source added with no start date reads only the last few days, so the
 * Activity Monitor shows a flat line on the day the admin finishes setting it
 * up — the moment they are most likely to conclude the integration is broken.
 * The form therefore proposes a start rather than leaving the field empty. It
 * is a proposal and nothing more: the admin can move it, and clearing it still
 * means the adapter's own default.
 *
 * The figures differ because the providers do, and because reading further
 * back is not free — every extra month is more pages on the first run. OpenAI
 * serves four years, so a year is a deliberate choice rather than a limit:
 * enough to show a year-on-year trend on day one without a first run that
 * reads four years of days. Neither figure is sized against a page count:
 * the Anthropic adapter asks for no page size, so how many pages a span
 * costs is the provider's to decide. A first read may well take several runs,
 * and that is fine — a run that reaches its page cap saves the cursor and the
 * next one resumes from it.
 *
 * Beside the cadence defaults and in one table for the same reason they are:
 * the proposal and any copy describing it have to read one source, or the form
 * proposes one span while the hint beside it names another.
 */
export const SOURCE_BACKFILL_MONTHS: Partial<Record<SourceType, number>> = {
  openai_admin: 12,
  anthropic_admin: 6,
};

/**
 * The instant a new source of this type proposes to read history from:
 * midnight UTC, that many months before today.
 *
 * Midnight UTC because every one of these reports is bucketed by UTC day, so a
 * start in the middle of one asks for a partial bucket the provider will not
 * serve. Undefined for a source type with no proposal, which leaves the field
 * empty and the adapter's own default in charge.
 *
 * The day is clamped to the target month's last, because `Date.UTC` rolls an
 * impossible day forward instead of refusing it: six months before the 31st of
 * August is the 31st of February, which arrives as the 3rd of March. The
 * proposal would then be five months back on a form whose hint says six.
 * Clamping lands on the 28th, which is what "six months before" means for a
 * month that has no 31st.
 */
export function defaultBackfillStart(
  sourceType: SourceType,
): string | undefined {
  const months = SOURCE_BACKFILL_MONTHS[sourceType];
  if (months === undefined) return undefined;
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() - months;
  // Day 0 of the following month is the last day of this one, and Date.UTC
  // normalizes a month outside 0-11 into the right year on the way.
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(now.getUTCDate(), lastDayOfTarget);
  return new Date(Date.UTC(year, month, day)).toISOString();
}

/** The recommended schedule for a source type, or null when it has no
 *  pull adapter (push and s3 sources carry no cadence). */
export function recommendedPullSchedule(sourceType: SourceType): string | null {
  const adapter = PULL_ADAPTER_FOR_SOURCE[sourceType];
  if (!adapter) return null;
  return PULL_SCHEDULE_DEFAULTS[adapter] ?? "*/15 * * * *";
}

/** Parse one plain integer cron field, or null for anything with an
 *  operator ("*", steps, lists, ranges) or out of range. */
function parsePlainInt({
  field,
  min,
  max,
}: {
  field: string;
  min: number;
  max: number;
}): number | null {
  if (!/^\d+$/.test(field)) return null;
  const n = Number(field);
  return n >= min && n <= max ? n : null;
}

/** Build the cron expression for the current friendly parts. */
export function cronFromPullParts(parts: PullCadenceParts): string {
  switch (parts.frequency) {
    case "minutes":
      return `*/${parts.everyMinutes} * * * *`;
    case "hourly":
      return `${parts.minute} * * * *`;
    case "daily":
      return `${parts.minute} ${parts.hour} * * *`;
    case "weekly":
      return `${parts.minute} ${parts.hour} * * ${parts.dayOfWeek}`;
  }
}

/** Neutral values for the parts a given frequency does not use, so the
 *  picker lands somewhere sensible when the admin switches frequency. */
const BASE_PARTS = { everyMinutes: 15, minute: 0, hour: 9, dayOfWeek: 1 };

interface CronShapeFields {
  minField: string;
  hourField: string;
  dowField: string;
}

/** The `*\/N * * * *` shape, N from MINUTE_INTERVALS. */
function minutesShape({
  minField,
  hourField,
  dowField,
}: CronShapeFields): PullCadenceParts | null {
  const stepMatch = /^\*\/(\d+)$/.exec(minField);
  if (!stepMatch) return null;
  const everyMinutes = Number(stepMatch[1]);
  if (!(MINUTE_INTERVALS as readonly number[]).includes(everyMinutes)) {
    return null;
  }
  if (hourField !== "*" || dowField !== "*") return null;
  return { ...BASE_PARTS, frequency: "minutes", everyMinutes };
}

/** The hourly / daily / weekly shapes, all anchored on a plain minute. */
function fixedMinuteShape({
  minField,
  hourField,
  dowField,
}: CronShapeFields): PullCadenceParts | null {
  const minute = parsePlainInt({ field: minField, min: 0, max: 59 });
  if (minute === null) return null;

  if (hourField === "*") {
    if (dowField !== "*") return null;
    return { ...BASE_PARTS, frequency: "hourly", minute };
  }

  const hour = parsePlainInt({ field: hourField, min: 0, max: 23 });
  if (hour === null) return null;

  if (dowField === "*") {
    return { ...BASE_PARTS, frequency: "daily", minute, hour };
  }

  const dayOfWeek = parsePlainInt({ field: dowField, min: 0, max: 6 });
  if (dayOfWeek === null) return null;
  return { ...BASE_PARTS, frequency: "weekly", minute, hour, dayOfWeek };
}

/**
 * Map a cron string back to the friendly picker parts. Returns null for any
 * expression outside the four shapes we generate ("custom") so the caller
 * can fall back to the raw-cron editor.
 */
export function partsFromPullCron(cron: string): PullCadenceParts | null {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minField = "", hourField = "", domField, monField, dowField = ""] =
    fields;
  // Month and day-of-month are wildcards in every shape we speak.
  if (monField !== "*" || domField !== "*") return null;
  const shape = { minField, hourField, dowField };
  return minutesShape(shape) ?? fixedMinuteShape(shape);
}

/**
 * Plain-words summary for the live "this checks…" line under the picker.
 */
export function summarizePullCadence(parts: PullCadenceParts): string {
  switch (parts.frequency) {
    case "minutes":
      return `Checks for new activity every ${parts.everyMinutes} minutes`;
    case "hourly":
      return parts.minute === 0
        ? "Checks for new activity every hour, on the hour"
        : `Checks for new activity every hour at ${parts.minute} minutes past`;
    case "daily":
      return `Checks for new activity every day at ${timeOfDay(parts)} UTC`;
    case "weekly":
      return `Checks for new activity every ${WEEKDAYS[parts.dayOfWeek] ?? "day"} at ${timeOfDay(parts)} UTC`;
  }
}

/**
 * The cadence as a few words for a table cell ("Every 15 minutes", "Daily
 * at 03:00 UTC"), or null when the source has no schedule. A cron outside
 * the four shapes the picker speaks reads "Custom schedule" rather than the
 * raw expression: the cell says that a schedule exists, the edit drawer
 * says what it is.
 */
export function shortPullCadence(
  cron: string | null | undefined,
): string | null {
  if (!cron || cron.trim() === "") return null;
  const parts = partsFromPullCron(cron);
  if (!parts) return "Custom schedule";
  switch (parts.frequency) {
    case "minutes":
      return `Every ${parts.everyMinutes} minutes`;
    case "hourly":
      return parts.minute === 0
        ? "Hourly"
        : `Hourly at ${parts.minute} minutes past`;
    case "daily":
      return `Daily at ${timeOfDay(parts)} UTC`;
    case "weekly":
      return `Weekly on ${WEEKDAYS[parts.dayOfWeek] ?? "a weekday"} at ${timeOfDay(parts)} UTC`;
  }
}

/**
 * Why this cron can't be saved, or null when it's fine. Mirrors the server's
 * `pullScheduleSchema` — five fields, croner parse, AND a reachable next run
 * (the server computes next-run-at and refuses a cron that never fires, e.g.
 * February 30th) — without importing the event-sourcing module chain into
 * the client bundle. Croner is the same library the scheduler uses, so a
 * cron this accepts is a cron the scheduler can register, never-firing
 * shapes included.
 */
export function pullCadenceCronError(cron: string): string | null {
  if (cron.trim() === "") return "Enter a schedule.";
  if (cron.trim().split(/\s+/).length !== 5) {
    return "A cron schedule has five fields: minute, hour, day of month, month, day of week.";
  }
  try {
    const next = new Cron(cron, { timezone: "UTC" }).nextRun();
    if (next === null) {
      return "This schedule never comes around — it names a date that does not exist.";
    }
    return null;
  } catch {
    return "This schedule can't run as written. Minutes go 0-59, hours 0-23.";
  }
}

/**
 * The create-blocking cadence error for the composer: blank means "use the
 * recommended schedule" and is always fine; anything typed must be runnable.
 * Sources without a pull adapter carry no cadence at all.
 */
export function composerCadenceError({
  sourceType,
  pullSchedule,
}: {
  sourceType: SourceType;
  pullSchedule: string;
}): string | null {
  if (!PULL_ADAPTER_FOR_SOURCE[sourceType]) return null;
  if (pullSchedule.trim() === "") return null;
  return pullCadenceCronError(pullSchedule);
}
