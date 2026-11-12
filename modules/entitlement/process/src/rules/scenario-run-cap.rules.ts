import type { PlanScenarioRunCap, ScenarioRunUsage } from "@langwatch/entitlement-contract";
import { Temporal } from "@langwatch/time";

import type { MeterWindow } from "../repositories/billable-events-meter.repository.ts";

export const DAY_MS = 24 * 60 * 60 * 1000;

type Capped = Extract<PlanScenarioRunCap, { capped: true }>;

/** When the grace after the first run ends; undefined before any run is metered. */
export function deriveGraceEndsAt({
  firstRunAt,
  cap,
}: {
  firstRunAt: number | null;
  cap: Pick<Capped, "graceDays">;
}): number | undefined {
  return firstRunAt === null ? undefined : firstRunAt + cap.graceDays * DAY_MS;
}

/** Whether the cap applies yet: never before the first run, nor while its grace runs. */
export function isInGrace({
  firstRunAt,
  cap,
  now,
}: {
  firstRunAt: number | null;
  cap: Pick<Capped, "graceDays">;
  now: number;
}): boolean {
  const graceEndsAt = deriveGraceEndsAt({ firstRunAt, cap });
  return graceEndsAt === undefined || now < graceEndsAt;
}

/** The UTC calendar month an instant falls in, as the events meter keys it, and its window. */
export function scenarioRunMonthOf(epochMs: number): { month: string } & MeterWindow {
  const month = Temporal.Instant.fromEpochMilliseconds(epochMs)
    .toZonedDateTimeISO("UTC")
    .toPlainDate()
    .toPlainYearMonth();
  return {
    month: month.toString(),
    startDate: `${month.toString()}-01 00:00:00.000`,
    endDate: `${month.add({ months: 1 }).toString()}-01 00:00:00.000`,
  };
}

/** True when one more run would go past a cap that applies. */
export function isRunRefused({
  runs,
  firstRunAt,
  cap,
  now,
}: {
  runs: number;
  firstRunAt: number | null;
  cap: Capped;
  now: number;
}): boolean {
  if (isInGrace({ firstRunAt, cap, now })) return false;
  return runs >= cap.maxPerMonth;
}

/** The usage page's reading of the month's runs; `runs` is null when the meter could not answer. */
export function scenarioRunUsageOf({
  runs,
  firstRunAt,
  cap,
  now,
}: {
  runs: number | null;
  firstRunAt: number | null;
  cap: Capped;
  now: number;
}): ScenarioRunUsage {
  const graceEndsAt = deriveGraceEndsAt({ firstRunAt, cap }) ?? null;
  const inGrace = isInGrace({ firstRunAt, cap, now });
  const base = { current: runs, max: cap.maxPerMonth, inGrace, graceEndsAt };
  if (graceEndsAt === null) {
    return {
      ...base,
      message: `${cap.maxPerMonth} runs a month, with no cap for ${cap.graceDays} days after your first run.`,
    };
  }
  if (inGrace) {
    const days = Math.max(1, Math.ceil((graceEndsAt - now) / DAY_MS));
    return {
      ...base,
      message: `No run cap for ${days} more ${days === 1 ? "day" : "days"}, then ${cap.maxPerMonth} runs a month.`,
    };
  }
  if (runs === null) return { ...base, message: `${cap.maxPerMonth} runs a month.` };
  return { ...base, message: `${runs} of ${cap.maxPerMonth} runs this month` };
}

/** The share of the monthly cap at which the heads-up is recorded. */
export const SCENARIO_RUNS_HEADS_UP_SHARE = 0.8;

/** A grace that ended this long before anyone looked is closed without its notice. */
export const GRACE_NOTICE_LATE_MS = 2 * DAY_MS;

/** True once the month's runs reach the heads-up share of the cap (80 of 100). */
export function isThresholdReached({
  runs,
  cap,
}: {
  runs: number;
  cap: Pick<Capped, "maxPerMonth">;
}): boolean {
  return runs >= Math.ceil(cap.maxPerMonth * SCENARIO_RUNS_HEADS_UP_SHARE);
}

/** Whether the grace still runs, just ended (record it), or ended too long ago to announce. */
export function decideGraceNotice({
  firstRunAt,
  cap,
  now,
}: {
  firstRunAt: number;
  cap: Pick<Capped, "graceDays">;
  now: number;
}): { kind: "running" | "ended" | "closedSilently"; graceEndsAt: number } {
  const graceEndsAt = firstRunAt + cap.graceDays * DAY_MS;
  if (now < graceEndsAt) return { kind: "running", graceEndsAt };
  if (now - graceEndsAt > GRACE_NOTICE_LATE_MS) return { kind: "closedSilently", graceEndsAt };
  return { kind: "ended", graceEndsAt };
}
