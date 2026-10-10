/**
 * One person's run on one board, folded onto its row: whose it is, which board, and how the
 * last run ended. The row is keyed by the schedule id, which is also its aggregate id.
 */

import type { StateProjectionDefinition, StateProjectionStore } from "@langwatch/eventing";
import {
  INSIGHT_DAILY_RUN_EVENT_TYPES,
  INSIGHT_DAILY_SCHEDULE_PROJECTION_VERSION,
  type InsightRunBoard,
  type InsightRunOutcome,
  type InsightRunReason,
} from "@langwatch/insight-contract";

import { isOwnScheduleId } from "../rules/insight-daily-run.rules.ts";
import type { InsightDailyRunEvent } from "./insight-daily-run.events.ts";

export interface InsightDailyScheduleState {
  readonly userId: string;
  readonly boardKind: InsightRunBoard["kind"];
  readonly boardId: string;
  readonly boardName: string;
  /** The last run that settled; every field is null until one did. */
  readonly lastRunId: string | null;
  /** Epoch milliseconds. */
  readonly lastRunAt: number | null;
  readonly lastRunOutcome: InsightRunOutcome | null;
  readonly lastRunReason: InsightRunReason | null;
  readonly lastRunFiled: number | null;
  readonly lastRunConversationId: string | null;
}

const INITIAL_INSIGHT_DAILY_SCHEDULE_STATE: InsightDailyScheduleState = {
  userId: "",
  boardKind: "dashboard",
  boardId: "",
  boardName: "",
  lastRunId: null,
  lastRunAt: null,
  lastRunOutcome: null,
  lastRunReason: null,
  lastRunFiled: null,
  lastRunConversationId: null,
};

export function applyInsightDailyRunEvent(
  state: InsightDailyScheduleState,
  event: InsightDailyRunEvent,
): InsightDailyScheduleState {
  if (event.type !== INSIGHT_DAILY_RUN_EVENT_TYPES.RUN_SETTLED) return state;
  // Delivery is at least once: a run settled again keeps the outcome it first recorded.
  if (state.lastRunId === event.data.runId) return state;
  const { userId, board, runId, outcome, reason, filedCount, conversationId } = event.data;
  // A row is its own person's and board's: an outcome that names another's schedule is not theirs.
  const owner = { projectId: String(event.tenantId), userId, board };
  if (!isOwnScheduleId({ scheduleId: event.aggregateId, ...owner })) return state;
  return {
    userId,
    boardKind: board.kind,
    boardId: board.id,
    boardName: board.name,
    lastRunId: runId,
    lastRunAt: event.occurredAt,
    lastRunOutcome: outcome,
    lastRunReason: reason,
    lastRunFiled: filedCount,
    lastRunConversationId: conversationId,
  };
}

export function createInsightDailyScheduleProjection(deps: {
  store: StateProjectionStore<InsightDailyScheduleState>;
}): StateProjectionDefinition<InsightDailyScheduleState, InsightDailyRunEvent> {
  return {
    name: "insightDailySchedule",
    version: INSIGHT_DAILY_SCHEDULE_PROJECTION_VERSION,
    eventTypes: [INSIGHT_DAILY_RUN_EVENT_TYPES.RUN_SETTLED],
    init: () => INITIAL_INSIGHT_DAILY_SCHEDULE_STATE,
    apply: applyInsightDailyRunEvent,
    store: deps.store,
    key: (event) => event.aggregateId,
  };
}
