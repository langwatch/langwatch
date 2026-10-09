import {
  AUTHZ_MEMBER_OFFBOARDED_EVENT_TYPE,
  authzMemberOffboardedEventDataSchema,
} from "@langwatch/authz-contract";
import { EventSchema } from "@langwatch/eventing";
import { z } from "zod";

export const AUTHZ_MEMBER_OFFBOARDED_PIPELINE_NAME = "authz_member_offboarded" as const;
export const AUTHZ_MEMBER_OFFBOARDED_AGGREGATE_TYPE = "authz_member_offboarded" as const;
export const AUTHZ_MEMBER_OFFBOARDED_EVENT_VERSION = "2026-10-09" as const;
export const RECORD_MEMBER_OFFBOARDED_COMMAND_TYPE = "lw.authz.record_member_offboarded" as const;

/** The command carries the event's data, which authz's contract declares for its peers. */
export const recordMemberOffboardedCommandDataSchema = authzMemberOffboardedEventDataSchema;
export type RecordMemberOffboardedCommandData = z.infer<
  typeof recordMemberOffboardedCommandDataSchema
>;

export const authzMemberOffboardedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(AUTHZ_MEMBER_OFFBOARDED_EVENT_TYPE),
  version: z.literal(AUTHZ_MEMBER_OFFBOARDED_EVENT_VERSION),
  data: authzMemberOffboardedEventDataSchema,
});
export type AuthzMemberOffboardedEvent = z.infer<typeof authzMemberOffboardedEventSchema>;
