/**
 * How many scheduled days in a row a schedule's run ended `skipped`. Folded from the runs'
 * outcomes alone, so the schedule's process and its row count alike and a replay counts once.
 * @see modules/insight/adrs/004-daily-run.md
 */

import {
  INSIGHT_SCHEDULE_SKIPPED_DAYS_BEFORE_OFF,
  type InsightRunOutcome,
  type InsightRunReason,
} from "@langwatch/insight-contract";

const SCHEDULED_RUN_PREFIX = "slot:";

/** A scheduled run is named by its slot; an operator's run is named by its request. */
export function scheduledRunId({ slot }: { slot: number }): string {
  return `${SCHEDULED_RUN_PREFIX}${slot}`;
}

export type SkipStreak = Readonly<{
  /** The scheduled days in a row whose run ended skipped. */
  count: number;
  /** The slot of the newest run counted; a run for no newer slot changes nothing. */
  slot: number | null;
}>;

export const NO_SKIP_STREAK: SkipStreak = { count: 0, slot: null };

/**
 * The streak after one run's outcome. A skipped scheduled run adds a day; filed, nothing or
 * failed starts over; an operator's run and a run on a From LangWatch board are no skipped
 * day. A run for a slot no newer than the last one counted is a repeat, and is ignored.
 */
export function foldSkipStreak({
  streak,
  run,
}: {
  streak: SkipStreak;
  run: { runId: string; slot: number; outcome: InsightRunOutcome; reason: InsightRunReason | null };
}): SkipStreak {
  if (streak.slot !== null && run.slot <= streak.slot) return streak;
  if (run.outcome !== "skipped") return { count: 0, slot: run.slot };
  if (!run.runId.startsWith(SCHEDULED_RUN_PREFIX)) return streak;
  if (run.reason === "template_board") return streak;
  return { count: streak.count + 1, slot: run.slot };
}

/** The person turned the run on or changed it: the count starts over and the slot is kept. */
export function restartSkipStreak({ slot }: SkipStreak): SkipStreak {
  return { count: 0, slot };
}

/** Whether a scheduled run that ends skipped is the day that turns its schedule off. */
export function isLastSkippedDay({ skippedDaysBefore }: { skippedDaysBefore: number }): boolean {
  return skippedDaysBefore + 1 >= INSIGHT_SCHEDULE_SKIPPED_DAYS_BEFORE_OFF;
}
