/**
 * How a daily insights schedule reads to an operator: what state it is in, in the order an
 * operator should look, and its facts in words. Pure, so the table and its tests agree.
 */

import type { OpsInsightSchedule } from "@langwatch/ops-contract";

/**
 * `not_armed`: on with no wake, so no run will start until the hourly pass arms it.
 * `skipping`: on, and its last scheduled runs were skipped. `turned_off`: the system did it.
 */
export type InsightScheduleStatus = "not_armed" | "skipping" | "on" | "turned_off" | "off";

export function insightScheduleStatus(schedule: OpsInsightSchedule): InsightScheduleStatus {
  if (!schedule.on) return schedule.offReason === null ? "off" : "turned_off";
  if (schedule.nextRunAt === null) return "not_armed";
  return schedule.consecutiveSkips > 0 ? "skipping" : "on";
}

/** The statuses in the order somebody should look at them. */
const ATTENTION_ORDER: InsightScheduleStatus[] = [
  "not_armed",
  "skipping",
  "on",
  "turned_off",
  "off",
];

/** Needs-a-look first, the schedule nearest to turning itself off before the others. */
export function compareInsightSchedules(a: OpsInsightSchedule, b: OpsInsightSchedule): number {
  const rank =
    ATTENTION_ORDER.indexOf(insightScheduleStatus(a)) -
    ATTENTION_ORDER.indexOf(insightScheduleStatus(b));
  if (rank !== 0) return rank;
  return b.consecutiveSkips - a.consecutiveSkips || a.id.localeCompare(b.id);
}

const OFF_REASON_WORDS: Record<string, string> = {
  board_deleted: "the board is gone",
  skipped_days: "skipped too many days in a row",
  member_removed: "the member left the organisation",
  project_archived: "the project was archived",
};

/** Why the system turned the schedule off; a reason this page does not know reads as it is. */
export function offReasonWords({ offReason }: Pick<OpsInsightSchedule, "offReason">): string {
  return offReason === null ? "" : (OFF_REASON_WORDS[offReason] ?? offReason);
}

/** "around 09:00 Europe/Amsterdam": a run starts at a minute within its hour. */
export function runTimeWords({ hour, timezone }: Pick<OpsInsightSchedule, "hour" | "timezone">) {
  if (hour === null || timezone === null) return "never set";
  return `around ${String(hour).padStart(2, "0")}:00 ${timezone}`;
}

/** "skipped · no_access": the outcome and reason as the run recorded them. */
export function lastRunWords({
  lastRunOutcome,
  lastRunReason,
}: Pick<OpsInsightSchedule, "lastRunOutcome" | "lastRunReason">): string {
  if (lastRunOutcome === null) return "no run yet";
  return lastRunReason === null ? lastRunOutcome : `${lastRunOutcome} · ${lastRunReason}`;
}

/** "2 skipped, off after 5 more": the skipped days beside how many more turn the schedule off. */
export function skippedDaysWords({
  consecutiveSkips,
  daysUntilOff,
}: Pick<OpsInsightSchedule, "consecutiveSkips" | "daysUntilOff">): string {
  if (daysUntilOff === null) return `${consecutiveSkips} skipped`;
  return `${consecutiveSkips} skipped, off after ${daysUntilOff} more`;
}
