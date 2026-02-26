import type { Event } from "../../domain/types";
import { EVALUATION_STARTED_EVENT_TYPE } from "../../pipelines/evaluation-processing/schemas/constants";
import { EXPERIMENT_RUN_EVENT_TYPES } from "../../pipelines/experiment-run-processing/schemas/constants";
import { SPAN_RECEIVED_EVENT_TYPE } from "../../pipelines/trace-processing/schemas/constants";
import type { FoldProjectionDefinition } from "../foldProjection.types";
import {
    projectDailyBillableEventsStore,
    type ProjectDailyBillableEventsState,
} from "./projectDailyBillableEvents.store";

export const PROJECT_DAILY_BILLABLE_EVENTS_PROJECTION_VERSION =
  "2026-02-17" as const;

function toUTCDateString(timestampMs: number): string {
  return new Date(timestampMs).toISOString().split("T")[0]!;
}

/**
 * Global fold projection that counts billable events per project per day.
 *
 * Billable event types:
 * - span_received (trace ingestion)
 * - evaluation.started (evaluation execution)
 * - experiment_run.started (experiment run start)
 *
 * - key: projectId:date
 * - registered globally — receives events from all pipelines
 * - Uses atomic SQL increment (store handles everything, apply is pass-through)
 */
export const projectDailyBillableEventsProjection: FoldProjectionDefinition<
  ProjectDailyBillableEventsState,
  Event
> = {
  name: "projectDailyBillableEvents",
  version: PROJECT_DAILY_BILLABLE_EVENTS_PROJECTION_VERSION,
  eventTypes: [
    SPAN_RECEIVED_EVENT_TYPE,
    EVALUATION_STARTED_EVENT_TYPE,
    EXPERIMENT_RUN_EVENT_TYPES.STARTED,
  ],

  key: (event) => {
    const date = toUTCDateString(event.timestamp);
    return date;
  },

  init: () => ({
    projectId: "",
    date: "",
    count: 0,
    lastEventTimestamp: null,
  }),

  apply(state, event) {
    return {
      projectId: String(event.tenantId),
      date: toUTCDateString(event.timestamp),
      count: state.count + 1,
      lastEventTimestamp: event.timestamp,
    };
  },

  store: projectDailyBillableEventsStore,
};
