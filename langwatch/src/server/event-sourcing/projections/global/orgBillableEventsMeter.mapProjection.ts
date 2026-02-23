import type { Event } from "../../domain/types";
import type { MapProjectionDefinition } from "../mapProjection.types";
import { EVALUATION_STARTED_EVENT_TYPE } from "../../pipelines/evaluation-processing/schemas/constants";
import { EXPERIMENT_RUN_EVENT_TYPES } from "../../pipelines/experiment-run-processing/schemas/constants";
import { SPAN_RECEIVED_EVENT_TYPE } from "../../pipelines/trace-processing/schemas/constants";
import {
  orgBillableEventsMeterStore,
  type BillableEventRecord,
} from "./orgBillableEventsMeter.store";

/**
 * Extracts a business-level deduplication key from a billable event.
 *
 * - span_received → traceId:spanId (from metadata)
 * - evaluation.started → evaluationId (from data)
 * - experiment_run.started → runId (from data)
 */
export function extractDeduplicationKey(event: Event): string | null {
  switch (event.type) {
    case SPAN_RECEIVED_EVENT_TYPE: {
      const metadata = event.metadata as
        | { traceId?: string; spanId?: string }
        | undefined;
      if (metadata?.traceId && metadata?.spanId) {
        return `${metadata.traceId}:${metadata.spanId}`;
      }
      return null;
    }
    case EVALUATION_STARTED_EVENT_TYPE: {
      const data = event.data as { evaluationId?: string } | undefined;
      if (data?.evaluationId) {
        return data.evaluationId;
      }
      return null;
    }
    case EXPERIMENT_RUN_EVENT_TYPES.STARTED: {
      const data = event.data as { runId?: string } | undefined;
      if (data?.runId) {
        return data.runId;
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Map projection that records billable events to ClickHouse for deduplicated counting.
 *
 * Reacts to the same event types as projectDailyBillableEvents (span_received,
 * evaluation.started, experiment_run.started). The pure map function extracts
 * a dedup key; the store handles org resolution and ClickHouse insert.
 */
export const orgBillableEventsMeterProjection: MapProjectionDefinition<
  BillableEventRecord,
  Event
> = {
  name: "orgBillableEventsMeter",
  eventTypes: [
    SPAN_RECEIVED_EVENT_TYPE,
    EVALUATION_STARTED_EVENT_TYPE,
    EXPERIMENT_RUN_EVENT_TYPES.STARTED,
  ],

  map(event: Event): BillableEventRecord | null {
    const deduplicationKey = extractDeduplicationKey(event);
    if (!deduplicationKey) return null;

    return {
      organizationId: "", // resolved by store
      tenantId: String(event.tenantId),
      eventId: event.id,
      eventType: event.type,
      deduplicationKey,
      eventTimestamp: event.timestamp,
    };
  },

  store: orgBillableEventsMeterStore,
};
