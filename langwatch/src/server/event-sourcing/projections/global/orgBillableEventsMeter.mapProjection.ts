import type { Event } from "../../domain/types";
import { EVALUATION_EVENT_TYPES } from "../../pipelines/evaluation-processing/schemas/constants";
import { EXPERIMENT_RUN_EVENT_TYPES } from "../../pipelines/experiment-run-processing/schemas/constants";
import { SIMULATION_RUN_EVENT_TYPES } from "../../pipelines/simulation-processing";
import { SPAN_RECEIVED_EVENT_TYPE } from "../../pipelines/trace-processing/schemas/constants";
import type { MapProjectionDefinition } from "../mapProjection.types";
import {
  type BillableEventRecord,
  orgBillableEventsMeterStore,
} from "./orgBillableEventsMeter.store";

/**
 * Extracts a deduplication key from a billable event.
 *
 * Uses `event.idempotencyKey` when present (business-level dedup),
 * otherwise falls back to `event.id` (unique per event).
 */
export function extractDeduplicationKey(event: Event): string {
  return event.idempotencyKey ?? event.id;
}

/**
 * Map projection that records billable events to ClickHouse for deduplicated counting.
 *
 * Reacts to billable event types and extracts a dedup key from the event
 * envelope; the store handles org resolution and ClickHouse insert.
 */
export const orgBillableEventsMeterProjection: MapProjectionDefinition<
  BillableEventRecord,
  Event
> = {
  name: "orgBillableEventsMeter",
  eventTypes: [
    SPAN_RECEIVED_EVENT_TYPE,

    EVALUATION_EVENT_TYPES.SCHEDULED,
    EVALUATION_EVENT_TYPES.STARTED,

    EXPERIMENT_RUN_EVENT_TYPES.STARTED,
    EXPERIMENT_RUN_EVENT_TYPES.EVALUATOR_RESULT,
    EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT,

    SIMULATION_RUN_EVENT_TYPES.STARTED,
    SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT,
  ],

  options: {
    groupKeyFn: (event: Event) => `billing:${event.id}`,
  },

  map(event: Event): BillableEventRecord {
    return {
      organizationId: "", // resolved by store
      tenantId: String(event.tenantId),
      eventId: event.id,
      eventType: event.type,
      deduplicationKey: extractDeduplicationKey(event),
      eventTimestamp: event.createdAt,
    };
  },

  store: orgBillableEventsMeterStore,
};
