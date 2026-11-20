import { insightRunOutcomeSchema, insightRunReasonSchema } from "@langwatch/insight-contract";
import type { Prisma } from "@langwatch/prisma-client/generated";

import type { InsightRunInFlightState } from "../../rules/insight-run-in-flight.rules.ts";

export type InsightRunInFlightRow = Prisma.InsightRunInFlightProjectionGetPayload<object>;

/** The outcome and the reason are TEXT, so the read narrows them back; an unknown one refuses. */
export function runInFlightStateFromRow(row: InsightRunInFlightRow): InsightRunInFlightState {
  return {
    runId: row.runId,
    conversationId: row.conversationId,
    startedAt: row.startedAt,
    lastSettledRunId: row.lastSettledRunId,
    lastRunAt: row.lastRunAt,
    lastRunOutcome:
      row.lastRunOutcome === null ? null : insightRunOutcomeSchema.parse(row.lastRunOutcome),
    lastRunReason:
      row.lastRunReason === null ? null : insightRunReasonSchema.parse(row.lastRunReason),
    lastRunFiled: row.lastRunFiled,
    lastRunRenewed: row.lastRunRenewed,
    lastRunConversationId: row.lastRunConversationId,
    newestRunId: row.newestRunId,
    newestRunSlot: row.newestRunSlot,
    newestRunSince: row.newestRunSince,
    lastSettledRunSlot: row.lastSettledRunSlot,
    lastSettledRunSince: row.lastSettledRunSince,
  };
}
