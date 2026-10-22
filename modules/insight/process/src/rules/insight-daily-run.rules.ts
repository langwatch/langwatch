/**
 * What a daily run derives from its own identity, never from a clock: its ids, the fixed
 * dates it reads, its conversation's title and which insight a finding repeats. Delivery is at
 * least once, so a run carried out twice must name the same schedule, insights and dates.
 */

import { createHash } from "node:crypto";

import {
  type InsightEntry,
  insightFolder,
  type InsightReplay,
  type InsightRunBoard,
} from "@langwatch/insight-contract";
import { Temporal } from "@langwatch/time";

import { isBoardHealthKey } from "./insight-board-health.rules.ts";

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

/**
 * Whether a run event names the schedule its own project, person and board derive. An event
 * that names any other is refused, so no run acts for a person its schedule is not for.
 */
export function isOwnScheduleId({
  scheduleId,
  ...owner
}: {
  scheduleId: string;
  projectId: string;
  userId: string;
  board: Pick<InsightRunBoard, "kind" | "id">;
}): boolean {
  return scheduleId === dailyScheduleId(owner);
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

/**
 * The id of the card a run's board check files for the key: the same on a retry, and never
 * an id of a Langy finding, whose ids start `insight_run_`.
 */
export function boardHealthInsightId({
  scheduleId,
  runId,
  key,
}: {
  scheduleId: string;
  runId: string;
  key: string;
}): string {
  return `insight_health_${digest([scheduleId, runId, key])}`;
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

/** The run's window as an insight's query replays it, with the values the query takes. */
export function dailyRunReplay({
  window,
  parameters = {},
}: {
  window: RunWindow;
  parameters?: InsightReplay["parameters"];
}): InsightReplay {
  return {
    start: window.start,
    end: window.end,
    granularitySeconds: DAILY_RUN_GRANULARITY_SECONDS,
    period: null,
    parameters,
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

type BoardInsights = Readonly<{
  entries: readonly InsightEntry[];
  boardId: string;
  slot: number;
}>;

/**
 * The person's insights a finding may repeat: on this board, not a board check's card, filed
 * before the run, and open at its slot or marked done. Newest first. An expired one is no match,
 * so its finding is filed as news. A renewal keeps an open one open, so a retry reads the same.
 */
export function matchableInsightsOfBoard({
  entries,
  boardId,
  slot,
}: BoardInsights): InsightEntry[] {
  return entries
    .filter(
      (entry) =>
        entry.board?.id === boardId &&
        !isBoardHealthKey(entry.findingKey) &&
        entry.filedAt < slot &&
        insightFolder({ entry, now: slot }) !== "stale",
    )
    .toSorted((a, b) => b.filedAt - a.filedAt || a.id.localeCompare(b.id));
}

/** The ones a brief lists: those of the above still in the person's inbox. */
export function openInsightsOfBoard(input: BoardInsights): InsightEntry[] {
  return matchableInsightsOfBoard(input).filter((entry) => entry.archivedAt === null);
}

/** What a run does with one finding: files it as a new insight, or renews the one it repeats. */
type RunFindingAct<Finding> =
  | Readonly<{ kind: "file"; finding: Finding; position: number }>
  | Readonly<{ kind: "renew"; finding: Finding; insight: InsightEntry }>;

/**
 * Decides each finding in the answer's order: it repeats the insight its `renews` names, else
 * the newest with its key, never one matched by its words. Dropped: a repeat of an insight
 * marked done, and a second finding for one insight or one key. `position` names a new id.
 */
export function decideRunFindings<
  Finding extends Readonly<{ findingKey: string | null; renews: string | null }>,
>({
  findings,
  insights,
}: {
  findings: readonly Finding[];
  /** What {@link matchableInsightsOfBoard} answers. */
  insights: readonly InsightEntry[];
}): RunFindingAct<Finding>[] {
  const taken = { insights: new Set<string>(), keys: new Set<string>() };
  return findings.flatMap((finding, position): RunFindingAct<Finding>[] => {
    const { findingKey: key, renews } = finding;
    const insight =
      insights.find((candidate) => candidate.id === renews) ??
      insights.find((candidate) => key !== null && candidate.findingKey === key);
    const repeatsThisAnswer =
      (insight !== undefined && taken.insights.has(insight.id)) ||
      (key !== null && taken.keys.has(key));
    if (insight) taken.insights.add(insight.id);
    if (key !== null) taken.keys.add(key);
    if (repeatsThisAnswer) return [];
    if (!insight) return [{ kind: "file", finding, position }];
    // Done, often by acting on it: finding it again is not news, and the run stays quiet.
    return insight.archivedAt === null ? [{ kind: "renew", finding, insight }] : [];
  });
}
