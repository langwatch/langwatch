import { EventSchema } from "@langwatch/eventing";
import {
  INTEGRATION_METHOD_CHOSEN_EVENT_TYPE,
  integrationMethodChosenEventDataSchema,
  INVITE_ACCEPTED_EVENT_TYPE,
  inviteAcceptedEventDataSchema,
  MEMBERS_INVITED_EVENT_TYPE,
  membersInvitedEventDataSchema,
  ORGANIZATION_PRESENCE_SETTING_CHANGED_EVENT_TYPE,
  ORGANIZATION_PRESENCE_SETTING_CHANGED_EVENT_VERSION,
  organizationPresenceSettingChangedEventDataSchema,
  ORGANIZATION_SIGNED_UP_EVENT_TYPE,
  organizationSignedUpEventDataSchema,
  PERSONAL_WORKSPACE_PROVISIONED_EVENT_TYPE,
  personalWorkspaceProvisionedEventDataSchema,
} from "@langwatch/organization-contract";
import { z } from "zod";

/** An organization's membership milestones, and the integration method its founder chose. */
export const ORGANIZATION_LIFECYCLE_PIPELINE_NAME = "organization_lifecycle" as const;
export const ORGANIZATION_AGGREGATE_TYPE = "organization" as const;
export const ORGANIZATION_LIFECYCLE_EVENT_VERSION = "2026-09-29" as const;

export const RECORD_SIGNED_UP_COMMAND_TYPE = "lw.organization.record_signed_up" as const;
export const RECORD_MEMBERS_INVITED_COMMAND_TYPE =
  "lw.organization.record_members_invited" as const;
export const RECORD_INVITE_ACCEPTED_COMMAND_TYPE =
  "lw.organization.record_invite_accepted" as const;
export const RECORD_INTEGRATION_METHOD_CHOSEN_COMMAND_TYPE =
  "lw.organization.record_integration_method_chosen" as const;
export const RECORD_PERSONAL_WORKSPACE_PROVISIONED_COMMAND_TYPE =
  "lw.organization.record_personal_workspace_provisioned" as const;
export const RECORD_PRESENCE_SETTING_CHANGED_COMMAND_TYPE =
  "lw.organization.record_presence_setting_changed" as const;

/** Somebody finished onboarding by creating this organization. */
export const recordSignedUpCommandDataSchema = organizationSignedUpEventDataSchema;
export type RecordSignedUpCommandData = z.infer<typeof recordSignedUpCommandDataSchema>;

/** One invitation batch: a role per invite, and the members plus pending invites counting it. */
export const recordMembersInvitedCommandDataSchema = membersInvitedEventDataSchema;
export type RecordMembersInvitedCommandData = z.infer<typeof recordMembersInvitedCommandDataSchema>;

/** An invitation was accepted by the person it named. */
export const recordInviteAcceptedCommandDataSchema = inviteAcceptedEventDataSchema;
export type RecordInviteAcceptedCommandData = z.infer<typeof recordInviteAcceptedCommandDataSchema>;

/** Somebody picked how they will integrate; tenant and aggregate are the user id. */
export const recordIntegrationMethodChosenCommandDataSchema =
  integrationMethodChosenEventDataSchema;
export type RecordIntegrationMethodChosenCommandData = z.infer<
  typeof recordIntegrationMethodChosenCommandDataSchema
>;

/** A personal workspace was created; project records its project as created (§9). */
export const recordPersonalWorkspaceProvisionedCommandDataSchema =
  personalWorkspaceProvisionedEventDataSchema;
export type RecordPersonalWorkspaceProvisionedCommandData = z.infer<
  typeof recordPersonalWorkspaceProvisionedCommandDataSchema
>;

const event = <Type extends string, Data extends z.ZodTypeAny>(type: Type, data: Data) =>
  z.object({
    ...EventSchema.shape,
    type: z.literal(type),
    version: z.literal(ORGANIZATION_LIFECYCLE_EVENT_VERSION),
    data,
  });

export const organizationSignedUpEventSchema = event(
  ORGANIZATION_SIGNED_UP_EVENT_TYPE,
  recordSignedUpCommandDataSchema,
);
export const membersInvitedEventSchema = event(
  MEMBERS_INVITED_EVENT_TYPE,
  recordMembersInvitedCommandDataSchema,
);
export const inviteAcceptedEventSchema = event(
  INVITE_ACCEPTED_EVENT_TYPE,
  recordInviteAcceptedCommandDataSchema,
);
export const integrationMethodChosenEventSchema = event(
  INTEGRATION_METHOD_CHOSEN_EVENT_TYPE,
  recordIntegrationMethodChosenCommandDataSchema,
);
export const personalWorkspaceProvisionedEventSchema = event(
  PERSONAL_WORKSPACE_PROVISIONED_EVENT_TYPE,
  recordPersonalWorkspaceProvisionedCommandDataSchema,
);
export type OrganizationSignedUpEvent = z.infer<typeof organizationSignedUpEventSchema>;
export type MembersInvitedEvent = z.infer<typeof membersInvitedEventSchema>;
export type InviteAcceptedEvent = z.infer<typeof inviteAcceptedEventSchema>;
export type IntegrationMethodChosenEvent = z.infer<typeof integrationMethodChosenEventSchema>;
export type PersonalWorkspaceProvisionedEvent = z.infer<
  typeof personalWorkspaceProvisionedEventSchema
>;
export type OrganizationLifecycleEvent =
  | OrganizationSignedUpEvent
  | MembersInvitedEvent
  | InviteAcceptedEvent
  | IntegrationMethodChosenEvent
  | PersonalWorkspaceProvisionedEvent;

/** The organization's presence switch; versioned on its own, born after the lifecycle's facts. */
export const recordPresenceSettingChangedCommandDataSchema =
  organizationPresenceSettingChangedEventDataSchema;
export type RecordPresenceSettingChangedCommandData = z.infer<
  typeof recordPresenceSettingChangedCommandDataSchema
>;

export const organizationPresenceSettingChangedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(ORGANIZATION_PRESENCE_SETTING_CHANGED_EVENT_TYPE),
  version: z.literal(ORGANIZATION_PRESENCE_SETTING_CHANGED_EVENT_VERSION),
  data: organizationPresenceSettingChangedEventDataSchema,
});
export type OrganizationPresenceSettingChangedEvent = z.infer<
  typeof organizationPresenceSettingChangedEventSchema
>;
