import type { Event } from "../../domain/types";
import type { MapProjectionDefinition } from "../mapProjection.types";
import { EVALUATION_STARTED_EVENT_TYPE } from "../../pipelines/evaluation-processing/schemas/constants";
import { EXPERIMENT_RUN_EVENT_TYPES } from "../../pipelines/experiment-run-processing/schemas/constants";
import { SPAN_RECEIVED_EVENT_TYPE } from "../../pipelines/trace-processing/schemas/constants";
import { orgBillingMeterDispatchStore } from "./orgBillingMeterDispatch.store";

/**
 * Record produced by the billing meter dispatch projection.
 * Contains only the tenantId (projectId) needed to resolve the organization.
 */
export interface OrgBillingMeterDispatchRecord {
  tenantId: string;
}

/**
 * Map projection that dispatches billable events to the usage reporting queue.
 *
 * Reacts to the same event types as projectDailyBillableEvents (span_received,
 * evaluation.started, experiment_run.started). The pure map function extracts
 * the tenantId; the store handles org resolution and queue dispatch.
 */
export const orgBillingMeterDispatchProjection: MapProjectionDefinition<
  OrgBillingMeterDispatchRecord,
  Event
> = {
  name: "orgBillingMeterDispatch",
  eventTypes: [
    SPAN_RECEIVED_EVENT_TYPE,
    EVALUATION_STARTED_EVENT_TYPE,
    EXPERIMENT_RUN_EVENT_TYPES.STARTED,
  ],

  map(event: Event): OrgBillingMeterDispatchRecord {
    return { tenantId: String(event.tenantId) };
  },

  store: orgBillingMeterDispatchStore,
};
