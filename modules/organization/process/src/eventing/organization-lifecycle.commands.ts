import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";
import {
  INTEGRATION_METHOD_CHOSEN_EVENT_TYPE,
  INVITE_ACCEPTED_EVENT_TYPE,
  MEMBERS_INVITED_EVENT_TYPE,
  ORGANIZATION_PRESENCE_SETTING_CHANGED_EVENT_TYPE,
  ORGANIZATION_PRESENCE_SETTING_CHANGED_EVENT_VERSION,
  ORGANIZATION_SIGNED_UP_EVENT_TYPE,
  ORGANIZATION_CREATED_EVENT_TYPE,
  ORGANIZATION_CREATED_EVENT_VERSION,
  ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE,
  ORGANIZATION_MEMBER_DISABLED_EVENT_VERSION,
  ORGANIZATION_MEMBER_ENABLED_EVENT_TYPE,
  ORGANIZATION_MEMBER_ENABLED_EVENT_VERSION,
  ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE,
  ORGANIZATION_MEMBER_REMOVED_EVENT_VERSION,
  ORGANIZATION_MEMBER_DEPARTMENT_CHANGED_EVENT_TYPE,
  ORGANIZATION_MEMBER_DEPARTMENT_CHANGED_EVENT_VERSION,
  ORGANIZATION_TRACE_SHARING_DISABLED_EVENT_TYPE,
  ORGANIZATION_TRACE_SHARING_DISABLED_EVENT_VERSION,
  PERSONAL_WORKSPACE_PROVISIONED_EVENT_TYPE,
  PERSONAL_TEAM_CREATED_EVENT_TYPE,
  PERSONAL_WORKSPACE_ARCHIVED_EVENT_TYPE,
  PERSONAL_WORKSPACE_REVIVED_EVENT_TYPE,
  PERSONAL_WORKSPACE_FEATURES_CHANGED_EVENT_TYPE,
} from "@langwatch/organization-contract";

import {
  type IntegrationMethodChosenEvent,
  type InviteAcceptedEvent,
  type MembersInvitedEvent,
  ORGANIZATION_AGGREGATE_TYPE,
  ORGANIZATION_LIFECYCLE_EVENT_VERSION,
  type OrganizationCreatedEvent,
  type OrganizationMemberDisabledEvent,
  type OrganizationMemberEnabledEvent,
  type OrganizationMemberRemovedEvent,
  type OrganizationMemberDepartmentChangedEvent,
  type OrganizationPresenceSettingChangedEvent,
  type OrganizationSignedUpEvent,
  type OrganizationTraceSharingDisabledEvent,
  type PersonalWorkspaceProvisionedEvent,
  type PersonalTeamCreatedEvent,
  type PersonalWorkspaceArchivedEvent,
  type PersonalWorkspaceRevivedEvent,
  type PersonalWorkspaceFeaturesChangedEvent,
  RECORD_INTEGRATION_METHOD_CHOSEN_COMMAND_TYPE,
  RECORD_CREATED_COMMAND_TYPE,
  RECORD_MEMBER_DISABLED_COMMAND_TYPE,
  RECORD_MEMBER_ENABLED_COMMAND_TYPE,
  RECORD_MEMBER_REMOVED_COMMAND_TYPE,
  RECORD_MEMBER_DEPARTMENT_CHANGED_COMMAND_TYPE,
  RECORD_INVITE_ACCEPTED_COMMAND_TYPE,
  RECORD_MEMBERS_INVITED_COMMAND_TYPE,
  RECORD_PERSONAL_WORKSPACE_PROVISIONED_COMMAND_TYPE,
  RECORD_PERSONAL_TEAM_CREATED_COMMAND_TYPE,
  RECORD_PERSONAL_WORKSPACE_ARCHIVED_COMMAND_TYPE,
  RECORD_PERSONAL_WORKSPACE_REVIVED_COMMAND_TYPE,
  RECORD_PERSONAL_WORKSPACE_FEATURES_CHANGED_COMMAND_TYPE,
  RECORD_PRESENCE_SETTING_CHANGED_COMMAND_TYPE,
  RECORD_SIGNED_UP_COMMAND_TYPE,
  RECORD_TRACE_SHARING_DISABLED_COMMAND_TYPE,
  type RecordIntegrationMethodChosenCommandData,
  recordIntegrationMethodChosenCommandDataSchema,
  type RecordInviteAcceptedCommandData,
  type RecordCreatedCommandData,
  recordCreatedCommandDataSchema,
  type RecordMemberDisabledCommandData,
  recordMemberDisabledCommandDataSchema,
  type RecordMemberEnabledCommandData,
  recordMemberEnabledCommandDataSchema,
  type RecordMemberRemovedCommandData,
  recordMemberRemovedCommandDataSchema,
  type RecordMemberDepartmentChangedCommandData,
  recordMemberDepartmentChangedCommandDataSchema,
  recordInviteAcceptedCommandDataSchema,
  type RecordMembersInvitedCommandData,
  recordMembersInvitedCommandDataSchema,
  type RecordPersonalWorkspaceProvisionedCommandData,
  type RecordPersonalTeamCreatedCommandData,
  recordPersonalWorkspaceProvisionedCommandDataSchema,
  recordPersonalTeamCreatedCommandDataSchema,
  type RecordPersonalWorkspaceArchivedCommandData,
  recordPersonalWorkspaceArchivedCommandDataSchema,
  type RecordPersonalWorkspaceRevivedCommandData,
  recordPersonalWorkspaceRevivedCommandDataSchema,
  type RecordPersonalWorkspaceFeaturesChangedCommandData,
  recordPersonalWorkspaceFeaturesChangedCommandDataSchema,
  type RecordPresenceSettingChangedCommandData,
  recordPresenceSettingChangedCommandDataSchema,
  type RecordSignedUpCommandData,
  recordSignedUpCommandDataSchema,
  type RecordTraceSharingDisabledCommandData,
  recordTraceSharingDisabledCommandDataSchema,
} from "./organization-lifecycle.events.ts";

/** Records an organization's sign-up; one event per organization, however often it is sent. */
export class RecordSignedUpCommand implements CommandHandler<
  Command<RecordSignedUpCommandData>,
  OrganizationSignedUpEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_SIGNED_UP_COMMAND_TYPE,
    recordSignedUpCommandDataSchema,
    "Record that somebody signed up by creating an organization",
  );

  handle(command: Command<RecordSignedUpCommandData>): OrganizationSignedUpEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<OrganizationSignedUpEvent>({
        aggregateType: ORGANIZATION_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: ORGANIZATION_SIGNED_UP_EVENT_TYPE,
        version: ORGANIZATION_LIFECYCLE_EVENT_VERSION,
        data,
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:signed_up`,
      }),
    ];
  }

  static getAggregateId(payload: RecordSignedUpCommandData): string {
    return payload.organizationId;
  }
}

/** Records one invitation batch, keyed by its first invite. */
export class RecordMembersInvitedCommand implements CommandHandler<
  Command<RecordMembersInvitedCommandData>,
  MembersInvitedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_MEMBERS_INVITED_COMMAND_TYPE,
    recordMembersInvitedCommandDataSchema,
    "Record that members were invited to an organization",
  );

  handle(command: Command<RecordMembersInvitedCommandData>): MembersInvitedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<MembersInvitedEvent>({
        aggregateType: ORGANIZATION_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: MEMBERS_INVITED_EVENT_TYPE,
        version: ORGANIZATION_LIFECYCLE_EVENT_VERSION,
        data,
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:invited:${data.inviteIds.join(",")}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordMembersInvitedCommandData): string {
    return payload.organizationId;
  }
}

/** Records an accepted invitation; one event per invitation. */
export class RecordInviteAcceptedCommand implements CommandHandler<
  Command<RecordInviteAcceptedCommandData>,
  InviteAcceptedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_INVITE_ACCEPTED_COMMAND_TYPE,
    recordInviteAcceptedCommandDataSchema,
    "Record that an invitation was accepted",
  );

  handle(command: Command<RecordInviteAcceptedCommandData>): InviteAcceptedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<InviteAcceptedEvent>({
        aggregateType: ORGANIZATION_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: INVITE_ACCEPTED_EVENT_TYPE,
        version: ORGANIZATION_LIFECYCLE_EVENT_VERSION,
        data,
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:${data.inviteId}:accepted`,
      }),
    ];
  }

  static getAggregateId(payload: RecordInviteAcceptedCommandData): string {
    return payload.organizationId;
  }
}

/** Records a chosen integration method; every choice is its own event, the last one wins. */
export class RecordIntegrationMethodChosenCommand implements CommandHandler<
  Command<RecordIntegrationMethodChosenCommandData>,
  IntegrationMethodChosenEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_INTEGRATION_METHOD_CHOSEN_COMMAND_TYPE,
    recordIntegrationMethodChosenCommandDataSchema,
    "Record the integration method somebody chose while onboarding",
  );

  handle(
    command: Command<RecordIntegrationMethodChosenCommandData>,
  ): IntegrationMethodChosenEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<IntegrationMethodChosenEvent>({
        aggregateType: ORGANIZATION_AGGREGATE_TYPE,
        aggregateId: data.userId,
        tenantId: createTenantId(command.tenantId),
        type: INTEGRATION_METHOD_CHOSEN_EVENT_TYPE,
        version: ORGANIZATION_LIFECYCLE_EVENT_VERSION,
        data,
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.userId}:integration_method:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordIntegrationMethodChosenCommandData): string {
    return payload.userId;
  }
}

/** Records a newly created personal workspace; its project is created once, so one event. */
export class RecordPersonalWorkspaceProvisionedCommand implements CommandHandler<
  Command<RecordPersonalWorkspaceProvisionedCommandData>,
  PersonalWorkspaceProvisionedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_PERSONAL_WORKSPACE_PROVISIONED_COMMAND_TYPE,
    recordPersonalWorkspaceProvisionedCommandDataSchema,
    "Record that a personal workspace and its project were created",
  );

  handle(
    command: Command<RecordPersonalWorkspaceProvisionedCommandData>,
  ): PersonalWorkspaceProvisionedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<PersonalWorkspaceProvisionedEvent>({
        aggregateType: ORGANIZATION_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: PERSONAL_WORKSPACE_PROVISIONED_EVENT_TYPE,
        version: ORGANIZATION_LIFECYCLE_EVENT_VERSION,
        data,
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.projectId}:personal_workspace_provisioned`,
      }),
    ];
  }

  static getAggregateId(payload: RecordPersonalWorkspaceProvisionedCommandData): string {
    return payload.organizationId;
  }
}

/**
 * Records a new personal team; keyed by the team, so a re-record from a pending ensure collapses.
 */
export class RecordPersonalTeamCreatedCommand implements CommandHandler<
  Command<RecordPersonalTeamCreatedCommandData>,
  PersonalTeamCreatedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_PERSONAL_TEAM_CREATED_COMMAND_TYPE,
    recordPersonalTeamCreatedCommandDataSchema,
    "Record that a personal team was created, for project to create its personal project",
  );

  handle(command: Command<RecordPersonalTeamCreatedCommandData>): PersonalTeamCreatedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<PersonalTeamCreatedEvent>({
        aggregateType: ORGANIZATION_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: PERSONAL_TEAM_CREATED_EVENT_TYPE,
        version: ORGANIZATION_LIFECYCLE_EVENT_VERSION,
        data,
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.teamId}:personal_team_created`,
      }),
    ];
  }

  static getAggregateId(payload: RecordPersonalTeamCreatedCommandData): string {
    return payload.organizationId;
  }
}

/** Records a removed member's archived personal teams; project archives their personal projects. */
export class RecordPersonalWorkspaceArchivedCommand implements CommandHandler<
  Command<RecordPersonalWorkspaceArchivedCommandData>,
  PersonalWorkspaceArchivedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_PERSONAL_WORKSPACE_ARCHIVED_COMMAND_TYPE,
    recordPersonalWorkspaceArchivedCommandDataSchema,
    "Record that a member's personal teams were archived, for project to archive their projects",
  );

  handle(
    command: Command<RecordPersonalWorkspaceArchivedCommandData>,
  ): PersonalWorkspaceArchivedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<PersonalWorkspaceArchivedEvent>({
        aggregateType: ORGANIZATION_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: PERSONAL_WORKSPACE_ARCHIVED_EVENT_TYPE,
        version: ORGANIZATION_LIFECYCLE_EVENT_VERSION,
        data,
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.userId}:personal_workspace_archived:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordPersonalWorkspaceArchivedCommandData): string {
    return payload.organizationId;
  }
}

/** Records a returning member's revived personal team; project revives its personal project. */
export class RecordPersonalWorkspaceRevivedCommand implements CommandHandler<
  Command<RecordPersonalWorkspaceRevivedCommandData>,
  PersonalWorkspaceRevivedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_PERSONAL_WORKSPACE_REVIVED_COMMAND_TYPE,
    recordPersonalWorkspaceRevivedCommandDataSchema,
    "Record that a personal team was revived, for project to revive its personal project",
  );

  handle(
    command: Command<RecordPersonalWorkspaceRevivedCommandData>,
  ): PersonalWorkspaceRevivedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<PersonalWorkspaceRevivedEvent>({
        aggregateType: ORGANIZATION_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: PERSONAL_WORKSPACE_REVIVED_EVENT_TYPE,
        version: ORGANIZATION_LIFECYCLE_EVENT_VERSION,
        data,
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.teamId}:personal_workspace_revived:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordPersonalWorkspaceRevivedCommandData): string {
    return payload.organizationId;
  }
}

/** Records the owner's feature switches; project stores them on its personal project. */
export class RecordPersonalWorkspaceFeaturesChangedCommand implements CommandHandler<
  Command<RecordPersonalWorkspaceFeaturesChangedCommandData>,
  PersonalWorkspaceFeaturesChangedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_PERSONAL_WORKSPACE_FEATURES_CHANGED_COMMAND_TYPE,
    recordPersonalWorkspaceFeaturesChangedCommandDataSchema,
    "Record a personal workspace's feature switches, for project to store them",
  );

  handle(
    command: Command<RecordPersonalWorkspaceFeaturesChangedCommandData>,
  ): PersonalWorkspaceFeaturesChangedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<PersonalWorkspaceFeaturesChangedEvent>({
        aggregateType: ORGANIZATION_AGGREGATE_TYPE,
        aggregateId: data.organizationId ?? data.projectId,
        tenantId: createTenantId(command.tenantId),
        type: PERSONAL_WORKSPACE_FEATURES_CHANGED_EVENT_TYPE,
        version: ORGANIZATION_LIFECYCLE_EVENT_VERSION,
        data,
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.projectId}:personal_workspace_features_changed:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordPersonalWorkspaceFeaturesChangedCommandData): string {
    return payload.organizationId ?? payload.projectId;
  }
}

/**
 * Records the organization's presence switch. A change is keyed on its moment; a backfill once per
 * organization, so a re-run collapses onto the first.
 */
export class RecordPresenceSettingChangedCommand implements CommandHandler<
  Command<RecordPresenceSettingChangedCommandData>,
  OrganizationPresenceSettingChangedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_PRESENCE_SETTING_CHANGED_COMMAND_TYPE,
    recordPresenceSettingChangedCommandDataSchema,
    "Record that an organization's presence setting changed",
  );

  handle(
    command: Command<RecordPresenceSettingChangedCommandData>,
  ): OrganizationPresenceSettingChangedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<OrganizationPresenceSettingChangedEvent>({
        aggregateType: ORGANIZATION_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: ORGANIZATION_PRESENCE_SETTING_CHANGED_EVENT_TYPE,
        version: ORGANIZATION_PRESENCE_SETTING_CHANGED_EVENT_VERSION,
        data,
        occurredAt: data.occurredAt,
        idempotencyKey: data.backfilled
          ? `${data.organizationId}:presence_setting:backfilled`
          : `${data.organizationId}:presence_setting:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordPresenceSettingChangedCommandData): string {
    return payload.organizationId;
  }
}

/** Records trace sharing switched off, keyed on its moment; share revokes from its own side. */
export class RecordTraceSharingDisabledCommand implements CommandHandler<
  Command<RecordTraceSharingDisabledCommandData>,
  OrganizationTraceSharingDisabledEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_TRACE_SHARING_DISABLED_COMMAND_TYPE,
    recordTraceSharingDisabledCommandDataSchema,
    "Record that an organization switched trace sharing off",
  );

  handle(
    command: Command<RecordTraceSharingDisabledCommandData>,
  ): OrganizationTraceSharingDisabledEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<OrganizationTraceSharingDisabledEvent>({
        aggregateType: ORGANIZATION_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: ORGANIZATION_TRACE_SHARING_DISABLED_EVENT_TYPE,
        version: ORGANIZATION_TRACE_SHARING_DISABLED_EVENT_VERSION,
        data,
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:trace_sharing_disabled:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordTraceSharingDisabledCommandData): string {
    return payload.organizationId;
  }
}

/** Records a seat taken away, keyed on the member and its moment; user revokes from its side. */
export class RecordMemberDisabledCommand implements CommandHandler<
  Command<RecordMemberDisabledCommandData>,
  OrganizationMemberDisabledEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_MEMBER_DISABLED_COMMAND_TYPE,
    recordMemberDisabledCommandDataSchema,
    "Record that an organization took a member's seat away",
  );

  handle(command: Command<RecordMemberDisabledCommandData>): OrganizationMemberDisabledEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<OrganizationMemberDisabledEvent>({
        aggregateType: ORGANIZATION_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE,
        version: ORGANIZATION_MEMBER_DISABLED_EVENT_VERSION,
        data,
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:member_disabled:${data.userId}:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordMemberDisabledCommandData): string {
    return payload.organizationId;
  }
}

/** Records a seat given back, keyed on the member and its moment; governance reacts on its side. */
export class RecordMemberEnabledCommand implements CommandHandler<
  Command<RecordMemberEnabledCommandData>,
  OrganizationMemberEnabledEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_MEMBER_ENABLED_COMMAND_TYPE,
    recordMemberEnabledCommandDataSchema,
    "Record that an organization gave a member's seat back",
  );

  handle(command: Command<RecordMemberEnabledCommandData>): OrganizationMemberEnabledEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<OrganizationMemberEnabledEvent>({
        aggregateType: ORGANIZATION_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: ORGANIZATION_MEMBER_ENABLED_EVENT_TYPE,
        version: ORGANIZATION_MEMBER_ENABLED_EVENT_VERSION,
        data,
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:member_enabled:${data.userId}:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordMemberEnabledCommandData): string {
    return payload.organizationId;
  }
}

/** Records a member removed, keyed on the member and its moment; governance reacts on its side. */
export class RecordMemberRemovedCommand implements CommandHandler<
  Command<RecordMemberRemovedCommandData>,
  OrganizationMemberRemovedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_MEMBER_REMOVED_COMMAND_TYPE,
    recordMemberRemovedCommandDataSchema,
    "Record that a member left an organization",
  );

  handle(command: Command<RecordMemberRemovedCommandData>): OrganizationMemberRemovedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<OrganizationMemberRemovedEvent>({
        aggregateType: ORGANIZATION_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE,
        version: ORGANIZATION_MEMBER_REMOVED_EVENT_VERSION,
        data,
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:member_removed:${data.userId}:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordMemberRemovedCommandData): string {
    return payload.organizationId;
  }
}

/** Records a member's department set or cleared; governance re-reads aggregates from it. */
export class RecordMemberDepartmentChangedCommand implements CommandHandler<
  Command<RecordMemberDepartmentChangedCommandData>,
  OrganizationMemberDepartmentChangedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_MEMBER_DEPARTMENT_CHANGED_COMMAND_TYPE,
    recordMemberDepartmentChangedCommandDataSchema,
    "Record that a member's department was set or cleared",
  );

  handle(
    command: Command<RecordMemberDepartmentChangedCommandData>,
  ): OrganizationMemberDepartmentChangedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<OrganizationMemberDepartmentChangedEvent>({
        aggregateType: ORGANIZATION_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: ORGANIZATION_MEMBER_DEPARTMENT_CHANGED_EVENT_TYPE,
        version: ORGANIZATION_MEMBER_DEPARTMENT_CHANGED_EVENT_VERSION,
        data,
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:member_department_changed:${data.userId}:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordMemberDepartmentChangedCommandData): string {
    return payload.organizationId;
  }
}

export class RecordCreatedCommand implements CommandHandler<
  Command<RecordCreatedCommandData>,
  OrganizationCreatedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_CREATED_COMMAND_TYPE,
    recordCreatedCommandDataSchema,
    "Record that an organization was created",
  );

  handle(command: Command<RecordCreatedCommandData>): OrganizationCreatedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<OrganizationCreatedEvent>({
        aggregateType: ORGANIZATION_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: ORGANIZATION_CREATED_EVENT_TYPE,
        version: ORGANIZATION_CREATED_EVENT_VERSION,
        data,
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:created`,
      }),
    ];
  }

  static getAggregateId(payload: RecordCreatedCommandData): string {
    return payload.organizationId;
  }
}
