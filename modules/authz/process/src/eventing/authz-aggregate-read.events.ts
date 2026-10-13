import {
  AUTHZ_AGGREGATE_READ_EVENT_TYPE,
  authzAggregateReadEventDataSchema,
} from "@langwatch/authz-contract";
import { EventSchema } from "@langwatch/eventing";
import { z } from "zod";

export const AUTHZ_AGGREGATE_READ_PIPELINE_NAME = "authz_aggregate_read" as const;
export const AUTHZ_AGGREGATE_READ_AGGREGATE_TYPE = "authz_aggregate_read" as const;
export const AUTHZ_AGGREGATE_READ_EVENT_VERSION = "2026-10-09" as const;
export const RECORD_AGGREGATE_READ_COMMAND_TYPE = "lw.authz.record_aggregate_read" as const;

/** The command carries the event's data, which authz's contract declares for its peers. */
export const recordAggregateReadCommandDataSchema = authzAggregateReadEventDataSchema;
export type RecordAggregateReadCommandData = z.infer<typeof recordAggregateReadCommandDataSchema>;

export const authzAggregateReadEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(AUTHZ_AGGREGATE_READ_EVENT_TYPE),
  version: z.literal(AUTHZ_AGGREGATE_READ_EVENT_VERSION),
  data: authzAggregateReadEventDataSchema,
});
export type AuthzAggregateReadEvent = z.infer<typeof authzAggregateReadEventSchema>;
