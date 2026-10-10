/**
 * One person's run on one board, folded onto its row: whose it is, which board, what they
 * chose for it and how the last run ended. The row is keyed by the schedule id, which is also
 * its aggregate id.
 */

import type { StateProjectionDefinition, StateProjectionStore } from "@langwatch/eventing";
import {
  INSIGHT_DAILY_RUN_EVENT_TYPES,
  INSIGHT_DAILY_RUN_SETTING_EVENT_TYPES,
  INSIGHT_DAILY_SCHEDULE_PROJECTION_VERSION,
  type InsightRunBoard,
  type InsightRunMaxInsights,
  type InsightRunOutcome,
  type InsightRunReason,
  type InsightScheduleState,
} from "@langwatch/insight-contract";

import { isOwnScheduleId } from "../rules/insight-daily-run.rules.ts";
import type { InsightDailyRunEvent } from "./insight-daily-run.events.ts";

export interface InsightDailyScheduleState {
  readonly userId: string;
  readonly boardKind: InsightRunBoard["kind"];
  readonly boardId: string;
  readonly boardName: string;
  /** `undecided` until the person turned the run on or said no to it. */
  readonly state: InsightScheduleState;
  /** What they last chose, kept while the run is off; null until they turned it on once. */
  readonly hour: number | null;
  readonly timezone: string | null;
  readonly maxInsights: InsightRunMaxInsights | null;
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
  state: "undecided",
  hour: null,
  timezone: null,
  maxInsights: null,
  lastRunId: null,
  lastRunAt: null,
  lastRunOutcome: null,
  lastRunReason: null,
  lastRunFiled: null,
  lastRunConversationId: null,
};

/** Whether the event leaves the row as it is: no event of the row's, or one it does not take. */
function leavesRow(state: InsightDailyScheduleState, event: InsightDailyRunEvent): boolean {
  switch (event.type) {
    case INSIGHT_DAILY_RUN_EVENT_TYPES.CONFIGURED:
      return false;
    case INSIGHT_DAILY_RUN_EVENT_TYPES.TURNED_OFF:
      // A run that found its board gone turns off a schedule that is on, and decides no other.
      return event.data.by === "system" && state.state !== "on";
    case INSIGHT_DAILY_RUN_EVENT_TYPES.RUN_SETTLED:
      // Delivery is at least once: a run settled again keeps the outcome it first recorded.
      return state.lastRunId === event.data.runId;
    default:
      return true;
  }
}

/** What the event writes on the row it changes. */
function changeOf(event: InsightDailyRunEvent): Partial<InsightDailyScheduleState> {
  switch (event.type) {
    case INSIGHT_DAILY_RUN_EVENT_TYPES.CONFIGURED: {
      const { hour, timezone, maxInsights } = event.data;
      return { state: "on", hour, timezone, maxInsights };
    }
    case INSIGHT_DAILY_RUN_EVENT_TYPES.TURNED_OFF:
      return { state: "off" };
    case INSIGHT_DAILY_RUN_EVENT_TYPES.RUN_SETTLED:
      return {
        lastRunId: event.data.runId,
        lastRunAt: event.occurredAt,
        lastRunOutcome: event.data.outcome,
        lastRunReason: event.data.reason,
        lastRunFiled: event.data.filedCount,
        lastRunConversationId: event.data.conversationId,
      };
    default:
      return {};
  }
}

export function applyInsightDailyRunEvent(
  state: InsightDailyScheduleState,
  event: InsightDailyRunEvent,
): InsightDailyScheduleState {
  if (leavesRow(state, event)) return state;
  const { userId, board } = event.data;
  // A row is its own person's and board's: an event that names another's schedule is not theirs.
  const owner = { projectId: String(event.tenantId), userId, board };
  if (!isOwnScheduleId({ scheduleId: event.aggregateId, ...owner })) return state;
  return {
    ...state,
    userId,
    boardKind: board.kind,
    boardId: board.id,
    boardName: board.name,
    ...changeOf(event),
  };
}

export function createInsightDailyScheduleProjection(deps: {
  store: StateProjectionStore<InsightDailyScheduleState>;
}): StateProjectionDefinition<InsightDailyScheduleState, InsightDailyRunEvent> {
  return {
    name: "insightDailySchedule",
    version: INSIGHT_DAILY_SCHEDULE_PROJECTION_VERSION,
    eventTypes: INSIGHT_DAILY_RUN_SETTING_EVENT_TYPES,
    init: () => INITIAL_INSIGHT_DAILY_SCHEDULE_STATE,
    apply: applyInsightDailyRunEvent,
    store: deps.store,
    key: (event) => event.aggregateId,
  };
}
