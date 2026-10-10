/**
 * What a daily run derives from its own identity, never from a clock: its ids, the fixed
 * dates it reads and the title of its conversation. Delivery is at least once, so a run
 * carried out twice must name the same schedule, the same insights and the same dates.
 */

import { createHash } from "node:crypto";

import {
  type InsightEntry,
  insightFolder,
  type InsightRunBoard,
} from "@langwatch/insight-contract";
import { Temporal } from "@langwatch/time";

function digest(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 32);
}

/** One schedule per person and board in a project, by construction. */
export function dailyScheduleId({
  projectId,
  userId,
  board,
}: {
  projectId: string;
  userId: string;
  board: Pick<InsightRunBoard, "kind" | "id">;
}): string {
  return `insightschedule_${digest([projectId, userId, board.kind, board.id])}`;
}

/** The id of the insight a run files for its finding at `position`: the same on a retry. */
export function runInsightId({
  scheduleId,
  runId,
  position,
}: {
  scheduleId: string;
  runId: string;
  position: number;
}): string {
  return `insight_run_${digest([scheduleId, runId, String(position)])}`;
}

/** A half-open `[start, end)` in epoch milliseconds. */
type RunWindow = Readonly<{ start: number; end: number }>;

/** The day a run reads and the day before it, to compare with. */
export type DailyRunWindows = Readonly<{ window: RunWindow; previous: RunWindow }>;

/** One-hour steps: a day reads as 24 points, on Langy's side and on the card that replays it. */
export const DAILY_RUN_GRANULARITY_SECONDS = 3_600;

/** The last full day before `slot` in `timezone`, and the full day before that one. */
export function dailyRunWindows({
  slot,
  timezone,
}: {
  slot: number;
  timezone: string;
}): DailyRunWindows {
  const today = Temporal.Instant.fromEpochMilliseconds(slot)
    .toZonedDateTimeISO(timezone)
    .startOfDay();
  const yesterday = today.subtract({ days: 1 });
  const dayBefore = today.subtract({ days: 2 });
  return {
    window: { start: yesterday.epochMilliseconds, end: today.epochMilliseconds },
    previous: { start: dayBefore.epochMilliseconds, end: yesterday.epochMilliseconds },
  };
}

const MAX_TITLE_BOARD_NAME_LENGTH = 120;

/** How the run's conversation reads in the person's Langy history. */
export function dailyRunConversationTitle({
  boardName,
  window,
  timezone,
}: {
  boardName: string;
  window: RunWindow;
  timezone: string;
}): string {
  const day = Temporal.Instant.fromEpochMilliseconds(window.start)
    .toZonedDateTimeISO(timezone)
    .toPlainDate()
    .toString();
  const board = boardName.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_BOARD_NAME_LENGTH);
  return `Daily insights - ${board} - ${day}`;
}

const MAX_POINTER_NAME_LENGTH = 200;

/** A board or widget name as a pointer keeps it: one line, within the pointer's limit. */
export function pointerName({ name, fallback }: { name: string; fallback: string }): string {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, MAX_POINTER_NAME_LENGTH).trim();
  return clean.length > 0 ? clean : fallback;
}

/**
 * The person's insights a run must not report again: in their inbox for this board as the
 * run's slot found it, newest first. Read against the slot, so a retry lists the same ones.
 */
export function openInsightsOfBoard({
  entries,
  boardId,
  slot,
}: {
  entries: readonly InsightEntry[];
  boardId: string;
  slot: number;
}): InsightEntry[] {
  return entries
    .filter(
      (entry) =>
        entry.board?.id === boardId &&
        entry.filedAt < slot &&
        insightFolder({ entry, now: slot }) === "inbox",
    )
    .toSorted((a, b) => b.filedAt - a.filedAt || a.id.localeCompare(b.id));
}
