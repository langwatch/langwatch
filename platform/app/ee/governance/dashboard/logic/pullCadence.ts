// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { SourceType } from "@ee/governance/dashboard/components/ingestionSourceCatalog";
import { Cron } from "croner";
import {
  timeOfDay,
  WEEKDAYS,
} from "~/features/automations/logic/reportSchedule";

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
  copilot_studio: "copilot_studio",
  openai_compliance: "openai_compliance",
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
  openai_compliance: "*/15 * * * *",
  claude_compliance: "*/15 * * * *",
  anthropic_admin: "0 * * * *",
  databricks_genie: "*/15 * * * *",
  http_polling: "*/15 * * * *",
};

/** The recommended schedule for a source type, or null when it has no
 *  pull adapter (push and s3 sources carry no cadence). */
export function recommendedPullSchedule(sourceType: SourceType): string | null {
  const adapter = PULL_ADAPTER_FOR_SOURCE[sourceType];
  if (!adapter) return null;
  return PULL_SCHEDULE_DEFAULTS[adapter] ?? "*/15 * * * *";
}

/** Parse one plain integer cron field, or null for anything with an
 *  operator ("*", steps, lists, ranges) or out of range. */
function parsePlainInt(field: string, min: number, max: number): number | null {
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

  const base = { everyMinutes: 15, minute: 0, hour: 9, dayOfWeek: 1 };

  const stepMatch = /^\*\/(\d+)$/.exec(minField);
  if (stepMatch) {
    const everyMinutes = Number(stepMatch[1]);
    if (!(MINUTE_INTERVALS as readonly number[]).includes(everyMinutes)) {
      return null;
    }
    if (hourField !== "*" || dowField !== "*") return null;
    return { ...base, frequency: "minutes", everyMinutes };
  }

  const minute = parsePlainInt(minField, 0, 59);
  if (minute === null) return null;

  if (hourField === "*") {
    if (dowField !== "*") return null;
    return { ...base, frequency: "hourly", minute };
  }

  const hour = parsePlainInt(hourField, 0, 23);
  if (hour === null) return null;

  if (dowField === "*") {
    return { ...base, frequency: "daily", minute, hour };
  }

  const dayOfWeek = parsePlainInt(dowField, 0, 6);
  if (dayOfWeek === null) return null;
  return { ...base, frequency: "weekly", minute, hour, dayOfWeek };
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
export function composerCadenceError(
  sourceType: SourceType,
  pullSchedule: string,
): string | null {
  if (!PULL_ADAPTER_FOR_SOURCE[sourceType]) return null;
  if (pullSchedule.trim() === "") return null;
  return pullCadenceCronError(pullSchedule);
}
