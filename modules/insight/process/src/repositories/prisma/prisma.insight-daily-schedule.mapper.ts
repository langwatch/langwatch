import {
  insightRunBoardSchema,
  insightRunOutcomeSchema,
  insightRunReasonSchema,
} from "@langwatch/insight-contract";
import type { Prisma } from "@langwatch/prisma-client/generated";

import type { InsightDailyScheduleState } from "../../eventing/insight-daily-schedule.projection.ts";

export type InsightDailyScheduleRow = Prisma.InsightDailyScheduleProjectionGetPayload<object>;

/**
 * The kind, the outcome and the reason are TEXT, so the read narrows them back; an unknown
 * one refuses loudly.
 */
export function dailyScheduleStateFromRow(row: InsightDailyScheduleRow): InsightDailyScheduleState {
  const board = insightRunBoardSchema.parse({
    kind: row.boardKind,
    id: row.boardId,
    name: row.boardName,
  });
  return {
    userId: row.userId,
    boardKind: board.kind,
    boardId: board.id,
    boardName: board.name,
    lastRunId: row.lastRunId,
    lastRunAt: row.lastRunAt,
    lastRunOutcome:
      row.lastRunOutcome === null ? null : insightRunOutcomeSchema.parse(row.lastRunOutcome),
    lastRunReason:
      row.lastRunReason === null ? null : insightRunReasonSchema.parse(row.lastRunReason),
    lastRunFiled: row.lastRunFiled,
    lastRunConversationId: row.lastRunConversationId,
  };
}
