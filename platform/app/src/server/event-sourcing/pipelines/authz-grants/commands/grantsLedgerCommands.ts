import { groupMembershipAggregateId } from "@langwatch/authz-server";
import { createTenantId, defineCommandSchema, EventUtils } from "../../..";
import type { Command, CommandHandler } from "../../../commands/command";
import { eventIdempotencyKey } from "../../../commands/idempotencyKey";
import {
  type AddGroupMemberCommandData,
  type AttachGrantCommandData,
  addGroupMemberCommandDataSchema,
  attachGrantCommandDataSchema,
  type ChangeGrantRoleCommandData,
  type ChangeRolePermissionsCommandData,
  changeGrantRoleCommandDataSchema,
  changeRolePermissionsCommandDataSchema,
  type DefineRoleCommandData,
  type DeleteRoleCommandData,
  defineRoleCommandDataSchema,
  deleteRoleCommandDataSchema,
  type RemoveGroupMemberCommandData,
  type RevokeGrantCommandData,
  removeGroupMemberCommandDataSchema,
  revokeGrantCommandDataSchema,
} from "../schemas/commands";
import {
  ADD_GROUP_MEMBER_COMMAND_TYPE,
  ATTACH_GRANT_COMMAND_TYPE,
  AUTHZ_GRANT_AGGREGATE_TYPE,
  AUTHZ_GRANTS_EVENT_VERSION_LATEST,
  CHANGE_GRANT_ROLE_COMMAND_TYPE,
  CHANGE_ROLE_PERMISSIONS_COMMAND_TYPE,
  DEFINE_ROLE_COMMAND_TYPE,
  DELETE_ROLE_COMMAND_TYPE,
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
  GROUP_MEMBER_ADDED_EVENT_TYPE,
  GROUP_MEMBER_REMOVED_EVENT_TYPE,
  REMOVE_GROUP_MEMBER_COMMAND_TYPE,
  REVOKE_GRANT_COMMAND_TYPE,
  ROLE_DEFINED_EVENT_TYPE,
  ROLE_DELETED_EVENT_TYPE,
  ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
} from "../schemas/constants";
import type {
  GrantAttachedEvent,
  GrantRevokedEvent,
  GrantRoleChangedEvent,
  GroupMemberAddedEvent,
  GroupMemberRemovedEvent,
  RoleDefinedEvent,
  RoleDeletedEvent,
  RolePermissionsChangedEvent,
} from "../schemas/events";

/**
 * The grant commands are pure appends: validate, stamp identity, emit.
 *
 * ADR-110 — a grant is its own aggregate and so is a role, so every handler
 * here takes its `aggregateId` from the entity the command is about. The
 * organization is the TENANT of each event (the stream it is persisted under
 * and the routing key that places it) and the aggregate of nothing. That is
 * the whole fix: with `aggregateId = organizationId` one aggregate's fold
 * state was every grant the organization had ever held, and each event batch
 * re-read all of them, so an import decelerated as it grew and could never
 * finish inside any timeout.
 *
 * One command names one entity, never a batch: a batch would straddle
 * aggregates. The import sends one command per grant instead, which is what
 * lets them fold concurrently.
 *
 * Every event's `idempotencyKey` is `<commandId>:<index>`, so a retried
 * command dedupes at the event store while distinct actions never collide.
 * A command that emits one event always uses index 0.
 */

export class AttachGrantCommand
  implements CommandHandler<Command<AttachGrantCommandData>, GrantAttachedEvent>
{
  static readonly schema = defineCommandSchema(
    ATTACH_GRANT_COMMAND_TYPE,
    attachGrantCommandDataSchema,
    "Record one access fact",
  );

  static getAggregateId(payload: AttachGrantCommandData): string {
    return payload.grant.grantId;
  }

  async handle(
    command: Command<AttachGrantCommandData>,
  ): Promise<GrantAttachedEvent[]> {
    const { commandId, grant } = command.data;
    const { occurredAtMs, ...data } = grant;
    return [
      EventUtils.createEvent<GrantAttachedEvent>({
        aggregateType: AUTHZ_GRANT_AGGREGATE_TYPE,
        aggregateId: grant.grantId,
        tenantId: createTenantId(command.tenantId),
        type: GRANT_ATTACHED_EVENT_TYPE,
        version: AUTHZ_GRANTS_EVENT_VERSION_LATEST,
        data,
        metadata: {},
        // The fact's OWN business time — an imported grant keeps the legacy
        // row's createdAt while `createdAt` (accepted time) stays honest.
        occurredAt: occurredAtMs,
        idempotencyKey: eventIdempotencyKey({ commandId, index: 0 }),
      }),
    ];
  }
}

export class ChangeGrantRoleCommand
  implements
    CommandHandler<Command<ChangeGrantRoleCommandData>, GrantRoleChangedEvent>
{
  static readonly schema = defineCommandSchema(
    CHANGE_GRANT_ROLE_COMMAND_TYPE,
    changeGrantRoleCommandDataSchema,
    "Change the role one grant confers",
  );

  static getAggregateId(payload: ChangeGrantRoleCommandData): string {
    return payload.grantId;
  }

  async handle(
    command: Command<ChangeGrantRoleCommandData>,
  ): Promise<GrantRoleChangedEvent[]> {
    const { commandId, grantId, from, to, actor, occurredAtMs } = command.data;
    return [
      EventUtils.createEvent<GrantRoleChangedEvent>({
        aggregateType: AUTHZ_GRANT_AGGREGATE_TYPE,
        aggregateId: grantId,
        tenantId: createTenantId(command.tenantId),
        type: GRANT_ROLE_CHANGED_EVENT_TYPE,
        version: AUTHZ_GRANTS_EVENT_VERSION_LATEST,
        data: { grantId, from, to, actor },
        metadata: {},
        occurredAt: occurredAtMs,
        idempotencyKey: eventIdempotencyKey({ commandId, index: 0 }),
      }),
    ];
  }
}

export class RevokeGrantCommand
  implements CommandHandler<Command<RevokeGrantCommandData>, GrantRevokedEvent>
{
  static readonly schema = defineCommandSchema(
    REVOKE_GRANT_COMMAND_TYPE,
    revokeGrantCommandDataSchema,
    "Revoke one grant",
  );

  static getAggregateId(payload: RevokeGrantCommandData): string {
    return payload.grantId;
  }

  async handle(
    command: Command<RevokeGrantCommandData>,
  ): Promise<GrantRevokedEvent[]> {
    const { commandId, grantId, reason, actor, occurredAtMs } = command.data;
    return [
      EventUtils.createEvent<GrantRevokedEvent>({
        aggregateType: AUTHZ_GRANT_AGGREGATE_TYPE,
        aggregateId: grantId,
        tenantId: createTenantId(command.tenantId),
        type: GRANT_REVOKED_EVENT_TYPE,
        version: AUTHZ_GRANTS_EVENT_VERSION_LATEST,
        data: { grantId, ...(reason ? { reason } : {}), actor },
        metadata: {},
        occurredAt: occurredAtMs,
        idempotencyKey: eventIdempotencyKey({ commandId, index: 0 }),
      }),
    ];
  }
}

export class DefineRoleCommand
  implements CommandHandler<Command<DefineRoleCommandData>, RoleDefinedEvent>
{
  static readonly schema = defineCommandSchema(
    DEFINE_ROLE_COMMAND_TYPE,
    defineRoleCommandDataSchema,
    "Record one role definition",
  );

  static getAggregateId(payload: DefineRoleCommandData): string {
    return payload.role.roleId;
  }

  async handle(
    command: Command<DefineRoleCommandData>,
  ): Promise<RoleDefinedEvent[]> {
    const { commandId, role, actor } = command.data;
    const { occurredAtMs, ...data } = role;
    return [
      EventUtils.createEvent<RoleDefinedEvent>({
        aggregateType: AUTHZ_GRANT_AGGREGATE_TYPE,
        aggregateId: role.roleId,
        tenantId: createTenantId(command.tenantId),
        type: ROLE_DEFINED_EVENT_TYPE,
        version: AUTHZ_GRANTS_EVENT_VERSION_LATEST,
        data: { ...data, actor },
        metadata: {},
        occurredAt: occurredAtMs,
        idempotencyKey: eventIdempotencyKey({ commandId, index: 0 }),
      }),
    ];
  }
}

export class ChangeRolePermissionsCommand
  implements
    CommandHandler<
      Command<ChangeRolePermissionsCommandData>,
      RolePermissionsChangedEvent
    >
{
  static readonly schema = defineCommandSchema(
    CHANGE_ROLE_PERMISSIONS_COMMAND_TYPE,
    changeRolePermissionsCommandDataSchema,
    "Change the permissions one role confers",
  );

  static getAggregateId(payload: ChangeRolePermissionsCommandData): string {
    return payload.roleId;
  }

  async handle(
    command: Command<ChangeRolePermissionsCommandData>,
  ): Promise<RolePermissionsChangedEvent[]> {
    const { commandId, roleId, permissions, actor, occurredAtMs } =
      command.data;
    return [
      EventUtils.createEvent<RolePermissionsChangedEvent>({
        aggregateType: AUTHZ_GRANT_AGGREGATE_TYPE,
        aggregateId: roleId,
        tenantId: createTenantId(command.tenantId),
        type: ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
        version: AUTHZ_GRANTS_EVENT_VERSION_LATEST,
        data: { roleId, permissions, actor },
        metadata: {},
        occurredAt: occurredAtMs,
        idempotencyKey: eventIdempotencyKey({ commandId, index: 0 }),
      }),
    ];
  }
}

export class DeleteRoleCommand
  implements CommandHandler<Command<DeleteRoleCommandData>, RoleDeletedEvent>
{
  static readonly schema = defineCommandSchema(
    DELETE_ROLE_COMMAND_TYPE,
    deleteRoleCommandDataSchema,
    "Delete one role definition",
  );

  static getAggregateId(payload: DeleteRoleCommandData): string {
    return payload.roleId;
  }

  async handle(
    command: Command<DeleteRoleCommandData>,
  ): Promise<RoleDeletedEvent[]> {
    const { commandId, roleId, actor, occurredAtMs } = command.data;
    return [
      EventUtils.createEvent<RoleDeletedEvent>({
        aggregateType: AUTHZ_GRANT_AGGREGATE_TYPE,
        aggregateId: roleId,
        tenantId: createTenantId(command.tenantId),
        type: ROLE_DELETED_EVENT_TYPE,
        version: AUTHZ_GRANTS_EVENT_VERSION_LATEST,
        data: { roleId, actor },
        metadata: {},
        occurredAt: occurredAtMs,
        idempotencyKey: eventIdempotencyKey({ commandId, index: 0 }),
      }),
    ];
  }
}

/**
 * A membership id is minted per FACT — adding somebody back to a group they
 * left is a new row with a new id, which is what makes "when did they join,
 * and when did they leave" answerable twice over rather than once.
 *
 * The AGGREGATE is the pair, not that id. Both commands here derive it the
 * same way, so every change to one person's membership of one group rides one
 * FIFO lane: `add`, its `remove`, and the `add` of the NEXT membership of the
 * same pair. Keying on the row id would put that last one in a lane of its
 * own, where it can overtake the removal it is supposed to follow and be
 * dropped by the projection's own live-pair guard.
 */
export class AddGroupMemberCommand
  implements
    CommandHandler<Command<AddGroupMemberCommandData>, GroupMemberAddedEvent>
{
  static readonly schema = defineCommandSchema(
    ADD_GROUP_MEMBER_COMMAND_TYPE,
    addGroupMemberCommandDataSchema,
    "Record one group membership",
  );

  static getAggregateId(payload: AddGroupMemberCommandData): string {
    return groupMembershipAggregateId(payload);
  }

  async handle(
    command: Command<AddGroupMemberCommandData>,
  ): Promise<GroupMemberAddedEvent[]> {
    const {
      commandId,
      membershipId,
      groupId,
      userId,
      source,
      actor,
      occurredAtMs,
    } = command.data;
    return [
      EventUtils.createEvent<GroupMemberAddedEvent>({
        aggregateType: AUTHZ_GRANT_AGGREGATE_TYPE,
        aggregateId: groupMembershipAggregateId({ groupId, userId }),
        tenantId: createTenantId(command.tenantId),
        type: GROUP_MEMBER_ADDED_EVENT_TYPE,
        version: AUTHZ_GRANTS_EVENT_VERSION_LATEST,
        data: { membershipId, groupId, userId, source, actor },
        metadata: {},
        // The fact's OWN business time — an imported membership keeps the
        // legacy row's createdAt while `createdAt` (accepted time) stays
        // honest.
        occurredAt: occurredAtMs,
        idempotencyKey: eventIdempotencyKey({ commandId, index: 0 }),
      }),
    ];
  }
}

export class RemoveGroupMemberCommand
  implements
    CommandHandler<
      Command<RemoveGroupMemberCommandData>,
      GroupMemberRemovedEvent
    >
{
  static readonly schema = defineCommandSchema(
    REMOVE_GROUP_MEMBER_COMMAND_TYPE,
    removeGroupMemberCommandDataSchema,
    "End one group membership",
  );

  static getAggregateId(payload: RemoveGroupMemberCommandData): string {
    return groupMembershipAggregateId(payload);
  }

  async handle(
    command: Command<RemoveGroupMemberCommandData>,
  ): Promise<GroupMemberRemovedEvent[]> {
    const {
      commandId,
      membershipId,
      groupId,
      userId,
      reason,
      actor,
      occurredAtMs,
    } = command.data;
    return [
      EventUtils.createEvent<GroupMemberRemovedEvent>({
        aggregateType: AUTHZ_GRANT_AGGREGATE_TYPE,
        aggregateId: groupMembershipAggregateId({ groupId, userId }),
        tenantId: createTenantId(command.tenantId),
        type: GROUP_MEMBER_REMOVED_EVENT_TYPE,
        version: AUTHZ_GRANTS_EVENT_VERSION_LATEST,
        data: {
          membershipId,
          groupId,
          userId,
          ...(reason ? { reason } : {}),
          actor,
        },
        metadata: {},
        occurredAt: occurredAtMs,
        idempotencyKey: eventIdempotencyKey({ commandId, index: 0 }),
      }),
    ];
  }
}
