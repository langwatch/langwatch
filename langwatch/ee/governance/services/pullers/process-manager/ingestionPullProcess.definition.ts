import { computeNextRunAt } from "~/server/app-layer/scheduler/nextRunAt";
import { INGESTION_PULL_EVENT_TYPES } from "@ee/event-sourcing/pipelines/ingestion-pull-processing/schemas/constants";
import type { IngestionPullProcessingEvent } from "@ee/event-sourcing/pipelines/ingestion-pull-processing/schemas/events";
import type {
  Evolution,
  ProcessDefinition,
  ProcessEventEnvelope,
  ProcessInput,
  ProcessIntent,
} from "~/server/event-sourcing/process-manager";

import {
  INGESTION_PULL_PROCESS_INTENT_TYPES,
  INGESTION_PULL_PROCESS_NAME,
  type IngestionPullProcessEventView,
  type IngestionPullProcessState,
  type IngestionPullRunIntent,
  ingestionPullProcessEventViewSchema,
} from "./ingestionPullProcess.types";

export const INGESTION_PULL_STALE_RUN_MS = 30 * 60 * 1000;

export function assertValidPullSchedule(cron: string): void {
  if (cron.trim().split(/\s+/).length !== 5) {
    throw new Error("pull schedule must be a five-field cron expression");
  }
  computeNextRunAt({ cron, timezone: "UTC", after: new Date() });
}

export function isValidPullSchedule(cron: string): boolean {
  try {
    assertValidPullSchedule(cron);
    return true;
  } catch {
    return false;
  }
}

function nextWake(cron: string, after: number): number {
  return computeNextRunAt({
    cron,
    timezone: "UTC",
    after: new Date(after),
  }).getTime();
}

export function toIngestionPullProcessEnvelope(
  event: IngestionPullProcessingEvent,
): ProcessEventEnvelope {
  return {
    eventId: event.id,
    eventType: event.type,
    occurredAt: event.occurredAt,
    tenantId: String(event.tenantId),
    projectId: String(event.tenantId),
    processKey: event.data.sourceId,
    payload: buildProcessEventView(event),
  };
}

function buildProcessEventView(
  event: IngestionPullProcessingEvent,
): IngestionPullProcessEventView {
  return {
    sourceId: event.data.sourceId,
    cron: "cron" in event.data ? event.data.cron : null,
    cursor:
      "cursor" in event.data
        ? event.data.cursor
        : "nextCursor" in event.data
          ? event.data.nextCursor
          : null,
    runId: "runId" in event.data ? event.data.runId : null,
  };
}

const INITIAL_STATE: IngestionPullProcessState = {
  sourceId: "",
  enabled: false,
  cron: null,
  cursor: null,
  currentRun: null,
};

function runIntent(params: IngestionPullRunIntent): ProcessIntent {
  return {
    messageKey: `pull:${params.sourceId}:${params.runId}`,
    intentType: INGESTION_PULL_PROCESS_INTENT_TYPES.RUN,
    payload: params,
  };
}

function settle(
  state: IngestionPullProcessState,
  after: number,
  intents: ProcessIntent[] = [],
): Evolution<IngestionPullProcessState> {
  return {
    state,
    nextWakeAt:
      state.enabled && state.cron ? nextWake(state.cron, after) : null,
    intents,
  };
}

function evolveEvent(
  previousState: IngestionPullProcessState,
  envelope: ProcessEventEnvelope,
  now: number,
): Evolution<IngestionPullProcessState> {
  const view = ingestionPullProcessEventViewSchema.parse(envelope.payload);
  // Schedule from whichever is later: the event's business time or the
  // instant it is actually handled. An event replayed hours late would
  // otherwise write a nextWakeAt that is already in the past.
  const schedulingRef = Math.max(envelope.occurredAt, now);

  switch (envelope.eventType) {
    case INGESTION_PULL_EVENT_TYPES.CONFIGURED:
      // The command boundary validates the cron; this guard is for events
      // that were committed anyway. Throwing here would poison the
      // subscriber forever (evolve re-runs the same committed event on
      // every retry), so degrade instead: keep the previous state and stand
      // down until a valid reconfiguration arrives.
      if (view.cron === null || !isValidPullSchedule(view.cron)) {
        return { state: previousState, nextWakeAt: null, intents: [] };
      }
      return settle(
        {
          ...previousState,
          sourceId: view.sourceId,
          enabled: true,
          cron: view.cron,
          cursor: previousState.sourceId ? previousState.cursor : view.cursor,
        },
        schedulingRef,
      );
    case INGESTION_PULL_EVENT_TYPES.DISABLED:
      return {
        state: {
          ...previousState,
          sourceId: view.sourceId,
          enabled: false,
          cron: null,
          currentRun: null,
        },
        nextWakeAt: null,
        intents: [],
      };
    case INGESTION_PULL_EVENT_TYPES.RUN_COMPLETED: {
      // Only the run this process is currently tracking may advance the
      // durable cursor. A late completion from a superseded run would
      // otherwise regress the live cursor and re-ingest its window.
      const isCurrentRun = previousState.currentRun?.runId === view.runId;
      return settle(
        {
          ...previousState,
          cursor: isCurrentRun ? view.cursor : previousState.cursor,
          currentRun: isCurrentRun ? null : previousState.currentRun,
        },
        schedulingRef,
      );
    }
    case INGESTION_PULL_EVENT_TYPES.RUN_FAILED:
      return settle(
        {
          ...previousState,
          currentRun:
            previousState.currentRun?.runId === view.runId
              ? null
              : previousState.currentRun,
        },
        schedulingRef,
      );
    default:
      return settle(previousState, schedulingRef);
  }
}

function evolveWake(
  previousState: IngestionPullProcessState,
  scheduledFor: number,
  handledAt: number,
): Evolution<IngestionPullProcessState> {
  if (!previousState.enabled || !previousState.cron) {
    return { state: previousState, nextWakeAt: null, intents: [] };
  }

  const active =
    previousState.currentRun !== null &&
    handledAt - previousState.currentRun.startedAt <
      INGESTION_PULL_STALE_RUN_MS;
  if (active) return settle(previousState, handledAt);

  const runId = String(scheduledFor);
  return settle(
    {
      ...previousState,
      currentRun: { runId, scheduledFor, startedAt: handledAt },
    },
    handledAt,
    [
      runIntent({
        sourceId: previousState.sourceId,
        runId,
        scheduledFor,
        cursor: previousState.cursor,
      }),
    ],
  );
}

export const ingestionPullProcessDefinition: ProcessDefinition<IngestionPullProcessState> =
  {
    name: INGESTION_PULL_PROCESS_NAME,
    initialState: INITIAL_STATE,
    evolve: ({
      previousState,
      input,
    }: {
      previousState: IngestionPullProcessState;
      input: ProcessInput;
    }) => {
      if (input.kind === "event") {
        return evolveEvent(previousState, input.event, input.now);
      }
      return evolveWake(previousState, input.scheduledFor, input.now);
    },
  };
