import {
  ATTACH_GRANT_COMMAND_TYPE,
  type AttachGrantCommandData,
  attachGrantCommandDataSchema,
  AUTHZ_GRANT_COMMAND_TYPES,
  AUTHZ_GRANTS_COMMAND_TYPES,
  AUTHZ_ROLE_COMMAND_TYPES,
  CHANGE_GRANT_ROLE_COMMAND_TYPE,
  CHANGE_ROLE_PERMISSIONS_COMMAND_TYPE,
  type ChangeGrantRoleCommandData,
  type ChangeRolePermissionsCommandData,
  changeGrantRoleCommandDataSchema,
  changeRolePermissionsCommandDataSchema,
  DEFINE_ROLE_COMMAND_TYPE,
  DELETE_ROLE_COMMAND_TYPE,
  type DefineRoleCommandData,
  type DeleteRoleCommandData,
  defineRoleCommandDataSchema,
  deleteRoleCommandDataSchema,
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
  type GrantRevokedPayload,
  AUTHZ_GRANTS_EVENT_VERSION_LATEST,
  REVOKE_GRANT_COMMAND_TYPE,
  type RevokeGrantCommandData,
  revokeGrantCommandDataSchema,
  ROLE_DEFINED_EVENT_TYPE,
  ROLE_DELETED_EVENT_TYPE,
  ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
} from "@langwatch/authz-contract";
import {
  type Command,
  type CommandHandler,
  type CommandSchema,
  createTenantId,
  defineCommandSchema,
  EventUtils,
} from "@langwatch/eventing";
import type { ZodSchema } from "zod";
import {
  AUTHZ_GRANT_AGGREGATE_TYPE,
  type GrantAttachedEvent,
  type GrantRevokedEvent,
  type GrantRoleChangedEvent,
  type RoleDefinedEvent,
  type RoleDeletedEvent,
  type RolePermissionsChangedEvent,
} from "./authz-grant.events.ts";

export {
  ATTACH_GRANT_COMMAND_TYPE,
  AUTHZ_GRANT_COMMAND_TYPES,
  AUTHZ_GRANTS_COMMAND_TYPES,
  AUTHZ_ROLE_COMMAND_TYPES,
  CHANGE_GRANT_ROLE_COMMAND_TYPE,
  CHANGE_ROLE_PERMISSIONS_COMMAND_TYPE,
  DEFINE_ROLE_COMMAND_TYPE,
  DELETE_ROLE_COMMAND_TYPE,
  REVOKE_GRANT_COMMAND_TYPE,
};

class AuthzEventingCommandMapper {
  static schema<Payload, const Type extends string>(
    type: Type,
    schema: ZodSchema<Payload>,
    description: string,
  ): CommandSchema<Payload, Type> {
    return defineCommandSchema(type, schema, description);
  }

  static idempotencyKey(commandId: string): string {
    return `${commandId}:0`;
  }
}

export class AttachGrantCommand implements CommandHandler<
  Command<AttachGrantCommandData>,
  GrantAttachedEvent
> {
  static readonly schema = AuthzEventingCommandMapper.schema(
    ATTACH_GRANT_COMMAND_TYPE,
    attachGrantCommandDataSchema,
    "Record one access fact",
  );

  static getAggregateId(payload: AttachGrantCommandData): string {
    return payload.grant.grantId;
  }

  handle(command: Command<AttachGrantCommandData>): GrantAttachedEvent[] {
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
        occurredAt: occurredAtMs,
        idempotencyKey: AuthzEventingCommandMapper.idempotencyKey(commandId),
      }),
    ];
  }
}

export class ChangeGrantRoleCommand implements CommandHandler<
  Command<ChangeGrantRoleCommandData>,
  GrantRoleChangedEvent
> {
  static readonly schema = AuthzEventingCommandMapper.schema(
    CHANGE_GRANT_ROLE_COMMAND_TYPE,
    changeGrantRoleCommandDataSchema,
    "Change the role one grant confers",
  );

  static getAggregateId(payload: ChangeGrantRoleCommandData): string {
    return payload.grantId;
  }

  handle(command: Command<ChangeGrantRoleCommandData>): GrantRoleChangedEvent[] {
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
        idempotencyKey: AuthzEventingCommandMapper.idempotencyKey(commandId),
      }),
    ];
  }
}

export class RevokeGrantCommand implements CommandHandler<
  Command<RevokeGrantCommandData>,
  GrantRevokedEvent
> {
  static readonly schema = AuthzEventingCommandMapper.schema(
    REVOKE_GRANT_COMMAND_TYPE,
    revokeGrantCommandDataSchema,
    "Revoke one grant",
  );

  static getAggregateId(payload: RevokeGrantCommandData): string {
    return payload.grantId;
  }

  handle(command: Command<RevokeGrantCommandData>): GrantRevokedEvent[] {
    const { commandId, grantId, reason, actor, occurredAtMs } = command.data;
    const data: GrantRevokedPayload = { grantId, actor };
    if (reason) data.reason = reason;
    return [
      EventUtils.createEvent<GrantRevokedEvent>({
        aggregateType: AUTHZ_GRANT_AGGREGATE_TYPE,
        aggregateId: grantId,
        tenantId: createTenantId(command.tenantId),
        type: GRANT_REVOKED_EVENT_TYPE,
        version: AUTHZ_GRANTS_EVENT_VERSION_LATEST,
        data,
        metadata: {},
        occurredAt: occurredAtMs,
        idempotencyKey: AuthzEventingCommandMapper.idempotencyKey(commandId),
      }),
    ];
  }
}

export class DefineRoleCommand implements CommandHandler<
  Command<DefineRoleCommandData>,
  RoleDefinedEvent
> {
  static readonly schema = AuthzEventingCommandMapper.schema(
    DEFINE_ROLE_COMMAND_TYPE,
    defineRoleCommandDataSchema,
    "Record one role definition",
  );

  static getAggregateId(payload: DefineRoleCommandData): string {
    return payload.role.roleId;
  }

  handle(command: Command<DefineRoleCommandData>): RoleDefinedEvent[] {
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
        idempotencyKey: AuthzEventingCommandMapper.idempotencyKey(commandId),
      }),
    ];
  }
}

export class ChangeRolePermissionsCommand implements CommandHandler<
  Command<ChangeRolePermissionsCommandData>,
  RolePermissionsChangedEvent
> {
  static readonly schema = AuthzEventingCommandMapper.schema(
    CHANGE_ROLE_PERMISSIONS_COMMAND_TYPE,
    changeRolePermissionsCommandDataSchema,
    "Change the permissions one role confers",
  );

  static getAggregateId(payload: ChangeRolePermissionsCommandData): string {
    return payload.roleId;
  }

  handle(command: Command<ChangeRolePermissionsCommandData>): RolePermissionsChangedEvent[] {
    const { commandId, roleId, permissions, actor, occurredAtMs } = command.data;
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
        idempotencyKey: AuthzEventingCommandMapper.idempotencyKey(commandId),
      }),
    ];
  }
}

export class DeleteRoleCommand implements CommandHandler<
  Command<DeleteRoleCommandData>,
  RoleDeletedEvent
> {
  static readonly schema = AuthzEventingCommandMapper.schema(
    DELETE_ROLE_COMMAND_TYPE,
    deleteRoleCommandDataSchema,
    "Delete one role definition",
  );

  static getAggregateId(payload: DeleteRoleCommandData): string {
    return payload.roleId;
  }

  handle(command: Command<DeleteRoleCommandData>): RoleDeletedEvent[] {
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
        idempotencyKey: AuthzEventingCommandMapper.idempotencyKey(commandId),
      }),
    ];
  }
}

/**
 * How many of ONE grant's queued same-command jobs fold into a single insert.
 * A ceiling on a redelivery or retry pile-up for one grant, not a throughput
 * lever: distinct grants keep distinct lanes and never share a batch.
 */
export const GRANT_COALESCE_MAX_BATCH = 50;
