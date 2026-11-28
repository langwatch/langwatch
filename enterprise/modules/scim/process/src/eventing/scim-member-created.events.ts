// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  SCIM_MEMBER_CREATED_EVENT_TYPE,
  SCIM_MEMBER_CREATED_EVENT_VERSION,
  scimMemberCreatedEventDataSchema,
} from "@langwatch/enterprise-scim-contract";
import { EventSchema } from "@langwatch/eventing";
import { z } from "zod";

export const RECORD_MEMBER_CREATED_COMMAND_TYPE = "lw.scim.record_member_created" as const;

export const recordMemberCreatedCommandDataSchema = scimMemberCreatedEventDataSchema;
export type RecordMemberCreatedCommandData = z.infer<typeof recordMemberCreatedCommandDataSchema>;

export const scimMemberCreatedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(SCIM_MEMBER_CREATED_EVENT_TYPE),
  version: z.literal(SCIM_MEMBER_CREATED_EVENT_VERSION),
  data: scimMemberCreatedEventDataSchema,
});
export type ScimMemberCreatedEvent = z.infer<typeof scimMemberCreatedEventSchema>;
