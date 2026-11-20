/**
 * A row per schedule (the aggregate id): the last started run, in flight until it settles, beside
 * the last settled run and how it ended. In the order runs started (ADR-004), a late start older
 * than the newest run leaves it, and so does a late outcome older than the last settled run's.
 */

import type { StateProjectionDefinition, StateProjectionStore } from "@langwatch/eventing";
import {
  INSIGHT_DAILY_RUN_EVENT_TYPES,
  INSIGHT_RUN_IN_FLIGHT_PROJECTION_VERSION,
} from "@langwatch/insight-contract";

import { isOlderRun, type RunOrder } from "../rules/insight-daily-run-order.rules.ts";
import { isOwnScheduleId } from "../rules/insight-daily-run.rules.ts";
import {
  NO_RUN_STARTED,
  type InsightRunInFlightState,
} from "../rules/insight-run-in-flight.rules.ts";
import type { InsightDailyRunEvent } from "./insight-daily-run.events.ts";

/** Whether the run is older than the newest the row took; false until it took one. */
function isOlderThanNewest(state: InsightRunInFlightState, run: RunOrder): boolean {
  const { newestRunId: runId, newestRunSlot: slot, newestRunSince: since } = state;
  if (runId === null || slot === null) return false;
  return isOlderRun({ run, newest: { runId, slot, since } });
}

/** Whether the run is older than the last settled one; false until the row took an outcome. */
function isOlderThanLastSettled(state: InsightRunInFlightState, run: RunOrder): boolean {
  const { lastSettledRunId: runId, lastSettledRunSlot: slot, lastSettledRunSince: since } = state;
  if (runId === null || slot === null) return false;
  return isOlderRun({ run, newest: { runId, slot, since } });
}

/** The run an event names; an older worker drops its start, so the row's own is kept for it. */
function runOf(state: InsightRunInFlightState, { runId, slot, since }: RunOrder): RunOrder {
  const known = state.newestRunId === runId ? state.newestRunSince : null;
  return { runId, slot, since: since ?? known ?? null };
}

/** The run an event names, as the row keeps it for its newest. */
function newestFrom({ runId, slot, since }: RunOrder): Partial<InsightRunInFlightState> {
  return { newestRunId: runId, newestRunSlot: slot, newestRunSince: since ?? null };
}

/** Whether the event leaves the row as it is. */
function leavesRow(state: InsightRunInFlightState, event: InsightDailyRunEvent): boolean {
  switch (event.type) {
    case INSIGHT_DAILY_RUN_EVENT_TYPES.RUN_STARTED: {
      // A start delivered again after its run settled is not a run in flight. A retried attempt
      // appends its own start under the same key: the first stands, as a replay keeps it.
      const { runId } = event.data;
      if (isOlderThanNewest(state, event.data)) return true;
      return state.lastSettledRunId === runId || state.runId === runId;
    }
    case INSIGHT_DAILY_RUN_EVENT_TYPES.RUN_SETTLED:
      // The first outcome stands, and an older run's leaves a newer one's. An outcome newer than
      // the last is taken even after a newer run started: that run stays in flight.
      if (state.lastSettledRunId === event.data.runId) return true;
      return isOlderThanLastSettled(state, runOf(state, event.data));
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
      return { runId, conversationId, startedAt: event.occurredAt, ...newestFrom(event.data) };
    }
    case INSIGHT_DAILY_RUN_EVENT_TYPES.RUN_SETTLED: {
      const { data } = event;
      const run = runOf(state, data);
      return {
        lastSettledRunId: data.runId,
        lastSettledRunSlot: run.slot,
        lastSettledRunSince: run.since ?? null,
        lastRunAt: event.occurredAt,
        lastRunOutcome: data.outcome,
        lastRunReason: data.reason,
        lastRunFiled: data.filedCount,
        lastRunRenewed: data.renewedCount,
        lastRunConversationId: data.conversationId,
        ...(isOlderThanNewest(state, run) ? {} : newestFrom(run)),
        // The settled run's start stays as its own. One kept for the run settled before goes, so
        // a later run that never started is not read as that one.
        ...(state.runId !== null && state.runId === state.lastSettledRunId
          ? { runId: null, conversationId: null, startedAt: null }
          : {}),
      };
    }
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
