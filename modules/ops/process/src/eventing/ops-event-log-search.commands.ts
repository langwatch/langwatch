import { defineCommand } from "@langwatch/eventing";
import { OPS_EVENT_LOG_SEARCH_COMPLETED_EVENT_TYPE } from "@langwatch/ops-contract";

import {
  EVENT_LOG_SEARCH_AGGREGATE_TYPE,
  EVENT_LOG_SEARCH_EVENT_VERSION,
  EVENT_LOG_SEARCH_REQUESTED_EVENT_TYPE,
  eventLogSearchDataSchema,
} from "./ops-event-log-search.events.ts";

/** Hands an accepted search to a worker; the request is its own aggregate, so a resend is one. */
export const RequestEventLogSearchCommand = defineCommand({
  commandType: "lw.ops.event_log_search.request",
  eventType: EVENT_LOG_SEARCH_REQUESTED_EVENT_TYPE,
  eventVersion: EVENT_LOG_SEARCH_EVENT_VERSION,
  aggregateType: EVENT_LOG_SEARCH_AGGREGATE_TYPE,
  schema: eventLogSearchDataSchema,
  aggregateId: ({ requestId }) => requestId,
  idempotencyKey: ({ requestId }) => `event_log_search:${requestId}`,
  makeJobId: ({ requestId }) => `event_log_search:${requestId}`,
});

/** The worker stored the answer; one completion per request, however often it is sent. */
export const RecordEventLogSearchCompletedCommand = defineCommand({
  commandType: "lw.ops.event_log_search.complete",
  eventType: OPS_EVENT_LOG_SEARCH_COMPLETED_EVENT_TYPE,
  eventVersion: EVENT_LOG_SEARCH_EVENT_VERSION,
  aggregateType: EVENT_LOG_SEARCH_AGGREGATE_TYPE,
  schema: eventLogSearchDataSchema,
  aggregateId: ({ requestId }) => requestId,
  idempotencyKey: ({ requestId }) => `event_log_search_completed:${requestId}`,
  makeJobId: ({ requestId }) => `event_log_search_completed:${requestId}`,
});
