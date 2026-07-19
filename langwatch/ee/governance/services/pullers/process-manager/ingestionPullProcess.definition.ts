import { computeNextRunAt } from "~/server/app-layer/scheduler/nextRunAt";
import { INGESTION_PULL_EVENT_TYPES } from "~/server/event-sourcing/pipelines/ingestion-pull-processing/schemas/constants";
import type { IngestionPullProcessingEvent } from "~/server/event-sourcing/pipelines/ingestion-pull-processing/schemas/events";
import type {
  Evolution,
  ProcessDefinition,
  ProcessEventEnvelope,
  ProcessIntent,
} from "~/server/event-sourcing/process-manager";

import {
  INGESTION_PULL_INTENT_TYPE,
  INGESTION_PULL_PROCESS_NAME,
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
    payload: {
      sourceId: event.data.sourceId,
      cron: "cron" in event.data ? event.data.cron : null,
      cursor:
        "cursor" in event.data
          ? event.data.cursor
          : "nextCursor" in event.data
            ? event.data.nextCursor
            : null,
      runId: "runId" in event.data ? event.data.runId : null,
    },
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
    intentType: INGESTION_PULL_INTENT_TYPE,
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

export const ingestionPullProcessDefinition: ProcessDefinition<IngestionPullProcessState> =
  {
    name: INGESTION_PULL_PROCESS_NAME,
    initialState: INITIAL_STATE,
    evolve: ({ previousState, input }) => {
      if (input.kind === "wake") {
        const handledAt = input.handledAt ?? input.scheduledFor;
        if (!previousState.enabled || !previousState.cron) {
          return { state: previousState, nextWakeAt: null, intents: [] };
        }
        const active =
          previousState.currentRun !== null &&
          handledAt - previousState.currentRun.startedAt <
            INGESTION_PULL_STALE_RUN_MS;
        if (active) return settle(previousState, handledAt);

        const runId = String(input.scheduledFor);
        return settle(
          {
            ...previousState,
            currentRun: {
              runId,
              scheduledFor: input.scheduledFor,
              startedAt: handledAt,
            },
          },
          handledAt,
          [
            runIntent({
              sourceId: previousState.sourceId,
              runId,
              scheduledFor: input.scheduledFor,
              cursor: previousState.cursor,
            }),
          ],
        );
      }

      const view = ingestionPullProcessEventViewSchema.parse(
        input.event.payload,
      );
      switch (input.event.eventType) {
        case INGESTION_PULL_EVENT_TYPES.CONFIGURED:
          if (view.cron === null) {
            throw new Error("configured ingestion pull requires a cron");
          }
          assertValidPullSchedule(view.cron);
          return settle(
            {
              ...previousState,
              sourceId: view.sourceId,
              enabled: true,
              cron: view.cron,
              cursor: previousState.sourceId
                ? previousState.cursor
                : view.cursor,
            },
            input.event.occurredAt,
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
        case INGESTION_PULL_EVENT_TYPES.RUN_COMPLETED:
          return settle(
            {
              ...previousState,
              cursor: view.cursor,
              currentRun:
                previousState.currentRun?.runId === view.runId
                  ? null
                  : previousState.currentRun,
            },
            input.event.occurredAt,
          );
        case INGESTION_PULL_EVENT_TYPES.RUN_FAILED:
          return settle(
            {
              ...previousState,
              currentRun:
                previousState.currentRun?.runId === view.runId
                  ? null
                  : previousState.currentRun,
            },
            input.event.occurredAt,
          );
        default:
          return settle(previousState, input.event.occurredAt);
      }
    },
  };
