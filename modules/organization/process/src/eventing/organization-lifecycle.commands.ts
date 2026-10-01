import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";
import {
  INTEGRATION_METHOD_CHOSEN_EVENT_TYPE,
  INVITE_ACCEPTED_EVENT_TYPE,
  MEMBERS_INVITED_EVENT_TYPE,
  ORGANIZATION_SIGNED_UP_EVENT_TYPE,
  PERSONAL_WORKSPACE_PROVISIONED_EVENT_TYPE,
} from "@langwatch/organization-contract";

import {
  type IntegrationMethodChosenEvent,
  type InviteAcceptedEvent,
  type MembersInvitedEvent,
  ORGANIZATION_AGGREGATE_TYPE,
  ORGANIZATION_LIFECYCLE_EVENT_VERSION,
  type OrganizationSignedUpEvent,
  type PersonalWorkspaceProvisionedEvent,
  RECORD_INTEGRATION_METHOD_CHOSEN_COMMAND_TYPE,
  RECORD_INVITE_ACCEPTED_COMMAND_TYPE,
  RECORD_MEMBERS_INVITED_COMMAND_TYPE,
  RECORD_PERSONAL_WORKSPACE_PROVISIONED_COMMAND_TYPE,
  RECORD_SIGNED_UP_COMMAND_TYPE,
  type RecordIntegrationMethodChosenCommandData,
  recordIntegrationMethodChosenCommandDataSchema,
  type RecordInviteAcceptedCommandData,
  recordInviteAcceptedCommandDataSchema,
  type RecordMembersInvitedCommandData,
  recordMembersInvitedCommandDataSchema,
  type RecordPersonalWorkspaceProvisionedCommandData,
  recordPersonalWorkspaceProvisionedCommandDataSchema,
  type RecordSignedUpCommandData,
  recordSignedUpCommandDataSchema,
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
