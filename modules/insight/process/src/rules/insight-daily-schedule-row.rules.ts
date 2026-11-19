/**
 * How a folded daily run row reads to its person. Shared by the Postgres read and its memory
 * twin, so both answer the same shape in the same order.
 */

import type {
  InsightDailyRun,
  InsightDailyRunSetting,
  InsightOperatorDailySchedule,
  InsightRunBoard,
  InsightRunSettings,
} from "@langwatch/insight-contract";

import type { InsightDailyScheduleState } from "../eventing/insight-daily-schedule.projection.ts";
import type { InsightRunInFlightState } from "../eventing/insight-run-in-flight.projection.ts";

/** How the row's last run ended; null until a run recorded an outcome. */
function lastRunOf(state: InsightDailyScheduleState): InsightDailyRun["lastRun"] {
  const { lastRunAt, lastRunOutcome } = state;
  if (lastRunAt === null || lastRunOutcome === null) return null;
  return {
    at: lastRunAt,
    outcome: lastRunOutcome,
    reason: state.lastRunReason,
    filedCount: state.lastRunFiled ?? 0,
    renewedCount: state.lastRunRenewed ?? 0,
    conversationId: state.lastRunConversationId,
  };
}

/**
 * The last run as its person reads it, with its id and its start; a requested run's id is its
 * request's. A run that never reached Langy names no start.
 */
function ownLastRunOf(
  state: InsightDailyScheduleState,
  started: InsightRunInFlightState,
): InsightDailyRunSetting["lastRun"] {
  const lastRun = lastRunOf(state);
  const { lastRunId: runId } = state;
  if (lastRun === null || runId === null) return null;
  const { startedAt } = started;
  const ownStart = started.runId === runId && startedAt !== null;
  return { ...lastRun, runId, ...(ownStart ? { startedAt } : {}) };
}

/**
 * The last run that started, while neither row names it settled: the two rows fold apart, so
 * either may be the first to take its outcome. The read drops one that is lost.
 */
function runInFlightOf(
  state: InsightDailyScheduleState,
  started: InsightRunInFlightState,
): InsightDailyRunSetting["runInFlight"] {
  const { runId, conversationId, startedAt, lastSettledRunId } = started;
  if (runId === null || conversationId === null || startedAt === null) return null;
  if (runId === lastSettledRunId || runId === state.lastRunId) return null;
  return { runId, conversationId, startedAt };
}

/** One run row as its person reads it; `lastRun` is null until a run recorded an outcome. */
export function dailyRunFromState({
  id,
  state,
}: {
  id: string;
  state: InsightDailyScheduleState;
}): InsightDailyRun {
  return {
    id,
    board: { kind: state.boardKind, id: state.boardId, name: state.boardName },
    lastRun: lastRunOf(state),
  };
}

/** What a person reads of a board they never decided on: no row holds it. */
export const UNDECIDED_DAILY_RUN_SETTING: InsightDailyRunSetting = {
  state: "undecided",
  settings: null,
  lastRun: null,
  offReason: null,
  runInFlight: null,
};

/** What the person chose for the row; null until they turned it on once. */
function settingsOf({
  hour,
  timezone,
  maxInsights,
}: InsightDailyScheduleState): InsightDailyRunSetting["settings"] {
  return hour === null || timezone === null || maxInsights === null
    ? null
    : { hour, timezone, maxInsights };
}

/**
 * The row's setting as its person reads it, beside its run in flight row (`NO_RUN_STARTED`
 * for a schedule that has none).
 */
export function dailyRunSettingFromState(
  state: InsightDailyScheduleState,
  started: InsightRunInFlightState,
): InsightDailyRunSetting {
  return {
    state: state.state,
    settings: settingsOf(state),
    lastRun: ownLastRunOf(state, started),
    offReason: state.offReason,
    runInFlight: runInFlightOf(state, started),
  };
}

/** Newest run first; rows with no run yet come last, and ties keep one order. */
export function byNewestRun(a: InsightDailyRun, b: InsightDailyRun): number {
  return (b.lastRun?.at ?? 0) - (a.lastRun?.at ?? 0) || a.id.localeCompare(b.id);
}

/** A schedule that is on, as a reconcile pass reads it: whose, which board and its setting. */
export type InsightOnSchedule = Readonly<{
  scheduleId: string;
  projectId: string;
  userId: string;
  board: InsightRunBoard;
  settings: InsightRunSettings;
}>;

/** The row as a reconcile pass reads it; none when it is not on. */
export function onScheduleFromState({
  scheduleId,
  projectId,
  state,
}: {
  scheduleId: string;
  projectId: string;
  state: InsightDailyScheduleState;
}): InsightOnSchedule[] {
  const settings = settingsOf(state);
  if (state.state !== "on" || settings === null) return [];
  const board = { kind: state.boardKind, id: state.boardId, name: state.boardName };
  return [{ scheduleId, projectId, userId: state.userId, board, settings }];
}

/** A schedule as an operator lists it, before its armed wake is read from its process. */
export type InsightDecidedSchedule = Omit<InsightOperatorDailySchedule, "nextRunAt">;

/** The row as an operator lists it; none while its person never turned it on or off. */
export function decidedScheduleFromState({
  scheduleId,
  projectId,
  state,
}: {
  scheduleId: string;
  projectId: string;
  state: InsightDailyScheduleState;
}): InsightDecidedSchedule[] {
  if (state.state === "undecided") return [];
  const board = { kind: state.boardKind, id: state.boardId, name: state.boardName };
  const { userId, consecutiveSkips, offReason } = state;
  const settings = settingsOf(state);
  return [
    {
      scheduleId,
      projectId,
      userId,
      board,
      settings,
      lastRun: lastRunOf(state),
      offReason,
      state: state.state,
      consecutiveSkips,
    },
  ];
}

/** The operator's order: the schedules that are on first, then by id. */
export function byOnThenId(a: InsightDecidedSchedule, b: InsightDecidedSchedule): number {
  if (a.state !== b.state) return a.state === "on" ? -1 : 1;
  return a.scheduleId < b.scheduleId ? -1 : 1;
}
