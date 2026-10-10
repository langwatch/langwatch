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
  ORGANIZATION_MEMBER_ENABLED_EVENT_TYPE,
  ORGANIZATION_MEMBER_ENABLED_EVENT_VERSION,
  organizationMemberEnabledEventDataSchema,
  ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE,
  ORGANIZATION_MEMBER_REMOVED_EVENT_VERSION,
  organizationMemberRemovedEventDataSchema,
  ORGANIZATION_MEMBER_DEPARTMENT_CHANGED_EVENT_TYPE,
  ORGANIZATION_MEMBER_DEPARTMENT_CHANGED_EVENT_VERSION,
  organizationMemberDepartmentChangedEventDataSchema,
  ORGANIZATION_TRACE_SHARING_DISABLED_EVENT_TYPE,
  ORGANIZATION_TRACE_SHARING_DISABLED_EVENT_VERSION,
  organizationTraceSharingDisabledEventDataSchema,
  PERSONAL_WORKSPACE_PROVISIONED_EVENT_TYPE,
  PERSONAL_TEAM_CREATED_EVENT_TYPE,
  personalWorkspaceProvisionedEventDataSchema,
  personalTeamCreatedEventDataSchema,
  PERSONAL_WORKSPACE_ARCHIVED_EVENT_TYPE,
  personalWorkspaceArchivedEventDataSchema,
  PERSONAL_WORKSPACE_REVIVED_EVENT_TYPE,
  personalWorkspaceRevivedEventDataSchema,
  PERSONAL_WORKSPACE_FEATURES_CHANGED_EVENT_TYPE,
  personalWorkspaceFeaturesChangedEventDataSchema,
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
export const RECORD_PERSONAL_WORKSPACE_ARCHIVED_COMMAND_TYPE =
  "lw.organization.record_personal_workspace_archived" as const;
export const RECORD_PERSONAL_WORKSPACE_REVIVED_COMMAND_TYPE =
  "lw.organization.record_personal_workspace_revived" as const;
export const RECORD_PERSONAL_WORKSPACE_FEATURES_CHANGED_COMMAND_TYPE =
  "lw.organization.record_personal_workspace_features_changed" as const;
export const RECORD_PRESENCE_SETTING_CHANGED_COMMAND_TYPE =
  "lw.organization.record_presence_setting_changed" as const;
export const RECORD_TRACE_SHARING_DISABLED_COMMAND_TYPE =
  "lw.organization.record_trace_sharing_disabled" as const;
export const RECORD_CREATED_COMMAND_TYPE = "lw.organization.record_created" as const;
export const RECORD_MEMBER_DISABLED_COMMAND_TYPE =
  "lw.organization.record_member_disabled" as const;
export const RECORD_MEMBER_REMOVED_COMMAND_TYPE = "lw.organization.record_member_removed" as const;
export const RECORD_MEMBER_ENABLED_COMMAND_TYPE = "lw.organization.record_member_enabled" as const;
export const RECORD_MEMBER_DEPARTMENT_CHANGED_COMMAND_TYPE =
  "lw.organization.record_member_department_changed" as const;

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

/** A personal workspace archived, revived or switched; project applies it to its project. */
export const recordPersonalWorkspaceArchivedCommandDataSchema =
  personalWorkspaceArchivedEventDataSchema;
export type RecordPersonalWorkspaceArchivedCommandData = z.infer<
  typeof recordPersonalWorkspaceArchivedCommandDataSchema
>;
export const recordPersonalWorkspaceRevivedCommandDataSchema =
  personalWorkspaceRevivedEventDataSchema;
export type RecordPersonalWorkspaceRevivedCommandData = z.infer<
  typeof recordPersonalWorkspaceRevivedCommandDataSchema
>;
export const recordPersonalWorkspaceFeaturesChangedCommandDataSchema =
  personalWorkspaceFeaturesChangedEventDataSchema;
export type RecordPersonalWorkspaceFeaturesChangedCommandData = z.infer<
  typeof recordPersonalWorkspaceFeaturesChangedCommandDataSchema
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
export const personalWorkspaceArchivedEventSchema = event(
  PERSONAL_WORKSPACE_ARCHIVED_EVENT_TYPE,
  recordPersonalWorkspaceArchivedCommandDataSchema,
);
export const personalWorkspaceRevivedEventSchema = event(
  PERSONAL_WORKSPACE_REVIVED_EVENT_TYPE,
  recordPersonalWorkspaceRevivedCommandDataSchema,
);
export const personalWorkspaceFeaturesChangedEventSchema = event(
  PERSONAL_WORKSPACE_FEATURES_CHANGED_EVENT_TYPE,
  recordPersonalWorkspaceFeaturesChangedCommandDataSchema,
);
export type OrganizationSignedUpEvent = z.infer<typeof organizationSignedUpEventSchema>;
export type MembersInvitedEvent = z.infer<typeof membersInvitedEventSchema>;
export type InviteAcceptedEvent = z.infer<typeof inviteAcceptedEventSchema>;
export type IntegrationMethodChosenEvent = z.infer<typeof integrationMethodChosenEventSchema>;
export type PersonalWorkspaceProvisionedEvent = z.infer<
  typeof personalWorkspaceProvisionedEventSchema
>;
export type PersonalTeamCreatedEvent = z.infer<typeof personalTeamCreatedEventSchema>;
export type PersonalWorkspaceArchivedEvent = z.infer<typeof personalWorkspaceArchivedEventSchema>;
export type PersonalWorkspaceRevivedEvent = z.infer<typeof personalWorkspaceRevivedEventSchema>;
export type PersonalWorkspaceFeaturesChangedEvent = z.infer<
  typeof personalWorkspaceFeaturesChangedEventSchema
>;
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

/** A seat given back (M8487-MEMBER-ENABLED). */
export const recordMemberEnabledCommandDataSchema = organizationMemberEnabledEventDataSchema;
export type RecordMemberEnabledCommandData = z.infer<typeof recordMemberEnabledCommandDataSchema>;

export const organizationMemberEnabledEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(ORGANIZATION_MEMBER_ENABLED_EVENT_TYPE),
  version: z.literal(ORGANIZATION_MEMBER_ENABLED_EVENT_VERSION),
  data: organizationMemberEnabledEventDataSchema,
});
export type OrganizationMemberEnabledEvent = z.infer<typeof organizationMemberEnabledEventSchema>;

/** A member removed; versioned on its own, born with the aggregate reconcile (M8487-OFFBOARD). */
export const recordMemberRemovedCommandDataSchema = organizationMemberRemovedEventDataSchema;
export type RecordMemberRemovedCommandData = z.infer<typeof recordMemberRemovedCommandDataSchema>;

export const organizationMemberRemovedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE),
  version: z.literal(ORGANIZATION_MEMBER_REMOVED_EVENT_VERSION),
  data: organizationMemberRemovedEventDataSchema,
});
export type OrganizationMemberRemovedEvent = z.infer<typeof organizationMemberRemovedEventSchema>;

/** A member's department set or cleared (M8487-DEPT-CHANGE). */
export const recordMemberDepartmentChangedCommandDataSchema =
  organizationMemberDepartmentChangedEventDataSchema;
export type RecordMemberDepartmentChangedCommandData = z.infer<
  typeof recordMemberDepartmentChangedCommandDataSchema
>;

export const organizationMemberDepartmentChangedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(ORGANIZATION_MEMBER_DEPARTMENT_CHANGED_EVENT_TYPE),
  version: z.literal(ORGANIZATION_MEMBER_DEPARTMENT_CHANGED_EVENT_VERSION),
  data: organizationMemberDepartmentChangedEventDataSchema,
});
export type OrganizationMemberDepartmentChangedEvent = z.infer<
  typeof organizationMemberDepartmentChangedEventSchema
>;

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
