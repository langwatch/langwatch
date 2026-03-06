import type { Event } from "../../domain/types";
import {
  EVALUATION_EVENT_TYPES,
  EVALUATION_STARTED_EVENT_TYPE,
} from "../../pipelines/evaluation-processing/schemas/constants";
import { EXPERIMENT_RUN_EVENT_TYPES } from "../../pipelines/experiment-run-processing/schemas/constants";
import { SIMULATION_RUN_EVENT_TYPES } from "../../pipelines/simulation-processing";
import { SPAN_RECEIVED_EVENT_TYPE } from "../../pipelines/trace-processing/schemas/constants";
import type { MapProjectionDefinition } from "../mapProjection.types";
import {
  type BillableEventRecord,
  orgBillableEventsMeterStore,
} from "./orgBillableEventsMeter.store";

/**
 * Extracts a business-level deduplication key from a billable event.
 *
 * - span_received → traceId:spanId (from metadata)
 * - evaluation.scheduled → evaluationId (from data)
 * - evaluation.started → evaluationId (from data)
 * - experiment_run.started → runId (from data)
 * - experiment_run.target_result → experimentId:runId:target:index:targetId
 * - experiment_run.evaluator_result → experimentId:runId:evaluator:index:targetId:evaluatorId
 * - simulation_run.started → scenarioRunId (from data)
 * - simulation_run.message_snapshot → scenarioRunId (from data, collapses per run)
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
    case EVALUATION_EVENT_TYPES.SCHEDULED:
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
    case EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT: {
      const data = event.data as {
        runId?: string;
        experimentId?: string;
        index?: number;
        targetId?: string;
      } | undefined;
      if (data?.experimentId && data?.runId && data?.index !== undefined && data?.targetId) {
        return `${data.experimentId}:${data.runId}:target:${data.index}:${data.targetId}`;
      }
      return null;
    }
    case EXPERIMENT_RUN_EVENT_TYPES.EVALUATOR_RESULT: {
      const data = event.data as {
        runId?: string;
        experimentId?: string;
        index?: number;
        targetId?: string;
        evaluatorId?: string;
      } | undefined;
      if (data?.experimentId && data?.runId && data?.index !== undefined && data?.targetId && data?.evaluatorId) {
        return `${data.experimentId}:${data.runId}:evaluator:${data.index}:${data.targetId}:${data.evaluatorId}`;
      }
      return null;
    }
    case SIMULATION_RUN_EVENT_TYPES.STARTED:
    case SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT: {
      const data = event.data as { scenarioRunId?: string } | undefined;
      if (data?.scenarioRunId) {
        return data.scenarioRunId;
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
 * Reacts to billable event types (span_received, evaluation.started,
 * experiment_run.started). The pure map function extracts a dedup key;
 * the store handles org resolution and ClickHouse insert.
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

  map(event: Event): BillableEventRecord | null {
    const deduplicationKey = extractDeduplicationKey(event);
    if (!deduplicationKey) return null;

    return {
      organizationId: "", // resolved by store
      tenantId: String(event.tenantId),
      eventId: event.id,
      eventType: event.type,
      deduplicationKey,
      eventTimestamp: event.createdAt,
    };
  },

  store: orgBillableEventsMeterStore,
};
