/**
 * How a folded daily run row reads to its person. Shared by the Postgres read and its memory
 * twin, so both answer the same shape in the same order.
 */

import type { InsightDailyRun } from "@langwatch/insight-contract";

import type { InsightDailyScheduleState } from "../eventing/insight-daily-schedule.projection.ts";

/** One run row as its person reads it; `lastRun` is null until a run recorded an outcome. */
export function dailyRunFromState({
  id,
  state,
}: {
  id: string;
  state: InsightDailyScheduleState;
}): InsightDailyRun {
  const { lastRunAt, lastRunOutcome } = state;
  return {
    id,
    board: { kind: state.boardKind, id: state.boardId, name: state.boardName },
    lastRun:
      lastRunAt === null || lastRunOutcome === null
        ? null
        : {
            at: lastRunAt,
            outcome: lastRunOutcome,
            reason: state.lastRunReason,
            filedCount: state.lastRunFiled ?? 0,
            conversationId: state.lastRunConversationId,
          },
  };
}

/** Newest run first; rows with no run yet come last, and ties keep one order. */
export function byNewestRun(a: InsightDailyRun, b: InsightDailyRun): number {
  return (b.lastRun?.at ?? 0) - (a.lastRun?.at ?? 0) || a.id.localeCompare(b.id);
}
