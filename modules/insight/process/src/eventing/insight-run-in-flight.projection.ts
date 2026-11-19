/**
 * A row per schedule, keyed by schedule id (the aggregate id): the last started run (id, Langy
 * conversation, start) beside the last settled run. It reads as in flight until it settles
 * (ADR-004).
 */

import type { StateProjectionDefinition, StateProjectionStore } from "@langwatch/eventing";
import {
  INSIGHT_DAILY_RUN_EVENT_TYPES,
  INSIGHT_RUN_IN_FLIGHT_PROJECTION_VERSION,
} from "@langwatch/insight-contract";

import { isOwnScheduleId } from "../rules/insight-daily-run.rules.ts";
import {
  NO_RUN_STARTED,
  type InsightRunInFlightState,
} from "../rules/insight-run-in-flight.rules.ts";
import type { InsightDailyRunEvent } from "./insight-daily-run.events.ts";

export { NO_RUN_STARTED, type InsightRunInFlightState };

/** Whether the event leaves the row as it is. */
function leavesRow(state: InsightRunInFlightState, event: InsightDailyRunEvent): boolean {
  switch (event.type) {
    case INSIGHT_DAILY_RUN_EVENT_TYPES.RUN_STARTED:
      // A start delivered again after its run settled is not a run in flight. A retried attempt
      // appends its own start under the same key: the first stands, as a replay keeps it. A start
      // delivered again after a newer run's events never reaches here: the fold drops an event
      // older than the row's cursor (`applyStateEvent`, packages/eventing stateProjectionExecutor).
      return state.lastSettledRunId === event.data.runId || state.runId === event.data.runId;
    case INSIGHT_DAILY_RUN_EVENT_TYPES.RUN_SETTLED:
      return state.lastSettledRunId === event.data.runId;
    default:
      return true;
  }
}

/** What the event writes on the row it changes. */
function changeOf(
  state: InsightRunInFlightState,
  event: InsightDailyRunEvent,
): Partial<InsightRunInFlightState> {
  switch (event.type) {
    case INSIGHT_DAILY_RUN_EVENT_TYPES.RUN_STARTED: {
      const { runId, conversationId } = event.data;
      return { runId, conversationId, startedAt: event.occurredAt };
    }
    case INSIGHT_DAILY_RUN_EVENT_TYPES.RUN_SETTLED:
      return {
        lastSettledRunId: event.data.runId,
        // The settled run's start stays as its own. One kept for the run settled before goes, so
        // a later run that never started is not read as that one.
        ...(state.runId !== null && state.runId === state.lastSettledRunId
          ? { runId: null, conversationId: null, startedAt: null }
          : {}),
      };
    default:
      return {};
  }
}

export function applyInsightRunInFlightEvent(
  state: InsightRunInFlightState,
  event: InsightDailyRunEvent,
): InsightRunInFlightState {
  if (leavesRow(state, event)) return state;
  const { userId, board } = event.data;
  // A row is its own person's and board's: an event that names another's schedule is not theirs.
  const owner = { projectId: String(event.tenantId), userId, board };
  if (!isOwnScheduleId({ scheduleId: event.aggregateId, ...owner })) return state;
  return { ...state, ...changeOf(state, event) };
}

export function createInsightRunInFlightProjection(deps: {
  store: StateProjectionStore<InsightRunInFlightState>;
}): StateProjectionDefinition<InsightRunInFlightState, InsightDailyRunEvent> {
  return {
    name: "insightRunInFlight",
    version: INSIGHT_RUN_IN_FLIGHT_PROJECTION_VERSION,
    eventTypes: [
      INSIGHT_DAILY_RUN_EVENT_TYPES.RUN_STARTED,
      INSIGHT_DAILY_RUN_EVENT_TYPES.RUN_SETTLED,
    ],
    init: () => NO_RUN_STARTED,
    apply: applyInsightRunInFlightEvent,
    store: deps.store,
    key: (event) => event.aggregateId,
  };
}
