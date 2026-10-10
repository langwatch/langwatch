import {
  insightRunBoardSchema,
  insightRunMaxInsightsSchema,
  insightRunOutcomeSchema,
  insightRunReasonSchema,
  insightScheduleStateSchema,
} from "@langwatch/insight-contract";
import type { Prisma } from "@langwatch/prisma-client/generated";

import type { InsightDailyScheduleState } from "../../eventing/insight-daily-schedule.projection.ts";

export type InsightDailyScheduleRow = Prisma.InsightDailyScheduleProjectionGetPayload<object>;

/**
 * The kind, the state, the outcome and the reason are TEXT and the maximum an integer, so the
 * read narrows them back; an unknown one refuses loudly.
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
    state: insightScheduleStateSchema.parse(row.state),
    hour: row.hour,
    timezone: row.timezone,
    maxInsights:
      row.maxInsights === null ? null : insightRunMaxInsightsSchema.parse(row.maxInsights),
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
