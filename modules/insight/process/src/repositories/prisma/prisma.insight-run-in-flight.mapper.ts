import type { Prisma } from "@langwatch/prisma-client/generated";

import type { InsightRunInFlightState } from "../../eventing/insight-run-in-flight.projection.ts";

export type InsightRunInFlightRow = Prisma.InsightRunInFlightProjectionGetPayload<object>;

/** Every column is the state's own type, so the read narrows nothing. */
export function runInFlightStateFromRow(row: InsightRunInFlightRow): InsightRunInFlightState {
  const { runId, conversationId, startedAt, lastSettledRunId } = row;
  return { runId, conversationId, startedAt, lastSettledRunId };
}
