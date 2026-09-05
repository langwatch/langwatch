import {
  SCIM_APPLY_FAILED_EVENT_TYPE,
  SCIM_APPLY_RECOVERED_EVENT_TYPE,
  SCIM_APPLY_REDRIVEN_EVENT_TYPE,
  SCIM_APPLY_RETIRED_EVENT_TYPE,
  SCIM_GROUP_MAPPED_EVENT_TYPE,
  SCIM_TOKEN_ISSUED_EVENT_TYPE,
  SCIM_TOKEN_REVOKED_EVENT_TYPE,
  SCIM_USER_PUSHED_EVENT_TYPE,
  scimApplyFailedPayloadSchema,
  scimApplyRecoveredPayloadSchema,
  scimApplyRedrivenPayloadSchema,
  scimApplyRetiredPayloadSchema,
  scimGroupMappedPayloadSchema,
  scimTokenIssuedPayloadSchema,
  scimTokenRevokedPayloadSchema,
  scimUserPushedPayloadSchema,
} from "@langwatch/identity";
import { z } from "zod";
import { EventSchema } from "../../../domain/types";

/**
 * The directory-sync pipeline's wire schemas: the framework envelope (id,
 * aggregate, tenant, cursor time) over the payloads `@langwatch/identity`
 * declares. What a fact SAYS is the package's; how it travels the event log
 * is the framework's, and this file is where the two meet.
 */

export const scimTokenIssuedEventSchema = EventSchema.extend({
  type: z.literal(SCIM_TOKEN_ISSUED_EVENT_TYPE),
  data: scimTokenIssuedPayloadSchema,
});
export type ScimTokenIssuedEvent = z.infer<typeof scimTokenIssuedEventSchema>;

export const scimUserPushedEventSchema = EventSchema.extend({
  type: z.literal(SCIM_USER_PUSHED_EVENT_TYPE),
  data: scimUserPushedPayloadSchema,
});
export type ScimUserPushedEvent = z.infer<typeof scimUserPushedEventSchema>;

export const scimGroupMappedEventSchema = EventSchema.extend({
  type: z.literal(SCIM_GROUP_MAPPED_EVENT_TYPE),
  data: scimGroupMappedPayloadSchema,
});
export type ScimGroupMappedEvent = z.infer<typeof scimGroupMappedEventSchema>;

export const scimApplyFailedEventSchema = EventSchema.extend({
  type: z.literal(SCIM_APPLY_FAILED_EVENT_TYPE),
  data: scimApplyFailedPayloadSchema,
});
export type ScimApplyFailedEvent = z.infer<typeof scimApplyFailedEventSchema>;

export const scimApplyRecoveredEventSchema = EventSchema.extend({
  type: z.literal(SCIM_APPLY_RECOVERED_EVENT_TYPE),
  data: scimApplyRecoveredPayloadSchema,
});
export type ScimApplyRecoveredEvent = z.infer<
  typeof scimApplyRecoveredEventSchema
>;

export const scimApplyRetiredEventSchema = EventSchema.extend({
  type: z.literal(SCIM_APPLY_RETIRED_EVENT_TYPE),
  data: scimApplyRetiredPayloadSchema,
});
export type ScimApplyRetiredEvent = z.infer<typeof scimApplyRetiredEventSchema>;

export const scimApplyRedrivenEventSchema = EventSchema.extend({
  type: z.literal(SCIM_APPLY_REDRIVEN_EVENT_TYPE),
  data: scimApplyRedrivenPayloadSchema,
});
export type ScimApplyRedrivenEvent = z.infer<
  typeof scimApplyRedrivenEventSchema
>;

export const scimTokenRevokedEventSchema = EventSchema.extend({
  type: z.literal(SCIM_TOKEN_REVOKED_EVENT_TYPE),
  data: scimTokenRevokedPayloadSchema,
});
export type ScimTokenRevokedEvent = z.infer<typeof scimTokenRevokedEventSchema>;

export const scimSyncEventSchema = z.discriminatedUnion("type", [
  scimTokenIssuedEventSchema,
  scimUserPushedEventSchema,
  scimGroupMappedEventSchema,
  scimApplyFailedEventSchema,
  scimApplyRecoveredEventSchema,
  scimApplyRetiredEventSchema,
  scimApplyRedrivenEventSchema,
  scimTokenRevokedEventSchema,
]);
export type ScimSyncEvent = z.infer<typeof scimSyncEventSchema>;
