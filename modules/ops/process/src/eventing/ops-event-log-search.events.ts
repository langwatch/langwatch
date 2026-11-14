import { EventSchema } from "@langwatch/eventing";
import { OPS_EVENT_LOG_SEARCH_COMPLETED_EVENT_TYPE } from "@langwatch/ops-contract";
import { z } from "zod";

export const EVENT_LOG_SEARCH_PIPELINE_NAME = "ops_event_log_search";
export const EVENT_LOG_SEARCH_AGGREGATE_TYPE = "event_log_search";
export const EVENT_LOG_SEARCH_REQUESTED_EVENT_TYPE = "lw.ops.event_log_search.requested";
export const EVENT_LOG_SEARCH_EVENT_VERSION = "2026-11-14";

/** The request id alone: the query waits in the result store, never in the event log. */
export const eventLogSearchDataSchema = z.object({ requestId: z.string().min(1) });
export type EventLogSearchData = z.infer<typeof eventLogSearchDataSchema>;

export const eventLogSearchRequestedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(EVENT_LOG_SEARCH_REQUESTED_EVENT_TYPE),
  version: z.literal(EVENT_LOG_SEARCH_EVENT_VERSION),
  data: eventLogSearchDataSchema,
});
export type EventLogSearchRequestedEvent = z.infer<typeof eventLogSearchRequestedEventSchema>;

/** Filed under the operator's own tenant, so its read hint reaches the operator's tabs. */
export const eventLogSearchCompletedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(OPS_EVENT_LOG_SEARCH_COMPLETED_EVENT_TYPE),
  version: z.literal(EVENT_LOG_SEARCH_EVENT_VERSION),
  data: eventLogSearchDataSchema,
});
export type EventLogSearchCompletedEvent = z.infer<typeof eventLogSearchCompletedEventSchema>;
