import { EventSchema } from "@langwatch/eventing";
import {
  INTEGRATION_METHOD_CHOSEN_EVENT_TYPE,
  integrationMethodChosenEventDataSchema,
  INVITE_ACCEPTED_EVENT_TYPE,
  inviteAcceptedEventDataSchema,
  ORGANIZATION_CREATED_EVENT_TYPE,
  ORGANIZATION_CREATED_EVENT_VERSION,
  organizationCreatedEventDataSchema,
  MEMBERS_INVITED_EVENT_TYPE,
  membersInvitedEventDataSchema,
  ORGANIZATION_PRESENCE_SETTING_CHANGED_EVENT_TYPE,
  ORGANIZATION_PRESENCE_SETTING_CHANGED_EVENT_VERSION,
  organizationPresenceSettingChangedEventDataSchema,
  ORGANIZATION_SIGNED_UP_EVENT_TYPE,
  organizationSignedUpEventDataSchema,
  ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE,
  ORGANIZATION_MEMBER_DISABLED_EVENT_VERSION,
  organizationMemberDisabledEventDataSchema,
  ORGANIZATION_TRACE_SHARING_DISABLED_EVENT_TYPE,
  ORGANIZATION_TRACE_SHARING_DISABLED_EVENT_VERSION,
  organizationTraceSharingDisabledEventDataSchema,
  PERSONAL_WORKSPACE_PROVISIONED_EVENT_TYPE,
  PERSONAL_TEAM_CREATED_EVENT_TYPE,
  personalWorkspaceProvisionedEventDataSchema,
  personalTeamCreatedEventDataSchema,
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
export const RECORD_PERSONAL_TEAM_CREATED_COMMAND_TYPE =
  "lw.organization.record_personal_team_created" as const;
export const RECORD_PRESENCE_SETTING_CHANGED_COMMAND_TYPE =
  "lw.organization.record_presence_setting_changed" as const;
export const RECORD_TRACE_SHARING_DISABLED_COMMAND_TYPE =
  "lw.organization.record_trace_sharing_disabled" as const;
export const RECORD_CREATED_COMMAND_TYPE = "lw.organization.record_created" as const;
export const RECORD_MEMBER_DISABLED_COMMAND_TYPE =
  "lw.organization.record_member_disabled" as const;

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

/** A personal team was created; project creates its personal project (Round 54). */
export const recordPersonalTeamCreatedCommandDataSchema = personalTeamCreatedEventDataSchema;
export type RecordPersonalTeamCreatedCommandData = z.infer<
  typeof recordPersonalTeamCreatedCommandDataSchema
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
export const personalTeamCreatedEventSchema = event(
  PERSONAL_TEAM_CREATED_EVENT_TYPE,
  recordPersonalTeamCreatedCommandDataSchema,
);
export type OrganizationSignedUpEvent = z.infer<typeof organizationSignedUpEventSchema>;
export type MembersInvitedEvent = z.infer<typeof membersInvitedEventSchema>;
export type InviteAcceptedEvent = z.infer<typeof inviteAcceptedEventSchema>;
export type IntegrationMethodChosenEvent = z.infer<typeof integrationMethodChosenEventSchema>;
export type PersonalWorkspaceProvisionedEvent = z.infer<
  typeof personalWorkspaceProvisionedEventSchema
>;
export type PersonalTeamCreatedEvent = z.infer<typeof personalTeamCreatedEventSchema>;
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

/** Trace sharing switched off; versioned on its own, like the presence switch. */
export const recordTraceSharingDisabledCommandDataSchema =
  organizationTraceSharingDisabledEventDataSchema;
export type RecordTraceSharingDisabledCommandData = z.infer<
  typeof recordTraceSharingDisabledCommandDataSchema
>;

export const organizationTraceSharingDisabledEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(ORGANIZATION_TRACE_SHARING_DISABLED_EVENT_TYPE),
  version: z.literal(ORGANIZATION_TRACE_SHARING_DISABLED_EVENT_VERSION),
  data: organizationTraceSharingDisabledEventDataSchema,
});
export type OrganizationTraceSharingDisabledEvent = z.infer<
  typeof organizationTraceSharingDisabledEventSchema
>;

/** A seat taken away; versioned on its own, like the trace sharing switch. */
export const recordMemberDisabledCommandDataSchema = organizationMemberDisabledEventDataSchema;
export type RecordMemberDisabledCommandData = z.infer<typeof recordMemberDisabledCommandDataSchema>;

export const organizationMemberDisabledEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE),
  version: z.literal(ORGANIZATION_MEMBER_DISABLED_EVENT_VERSION),
  data: organizationMemberDisabledEventDataSchema,
});
export type OrganizationMemberDisabledEvent = z.infer<typeof organizationMemberDisabledEventSchema>;

/** An organization now exists; versioned on its own, born after the lifecycle's first facts. */
export const recordCreatedCommandDataSchema = organizationCreatedEventDataSchema;
export type RecordCreatedCommandData = z.infer<typeof recordCreatedCommandDataSchema>;

export const organizationCreatedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(ORGANIZATION_CREATED_EVENT_TYPE),
  version: z.literal(ORGANIZATION_CREATED_EVENT_VERSION),
  data: organizationCreatedEventDataSchema,
});
export type OrganizationCreatedEvent = z.infer<typeof organizationCreatedEventSchema>;
