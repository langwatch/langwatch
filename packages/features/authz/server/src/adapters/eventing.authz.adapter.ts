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
  type GrantAttachedPayload,
  GRANT_ATTACHED_EVENT_TYPE,
  type GrantRevokedPayload,
  GRANT_REVOKED_EVENT_TYPE,
  type GrantRoleChangedPayload,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
  AUTHZ_GRANTS_EVENT_TYPES,
  AUTHZ_GRANTS_EVENT_VERSION_LATEST,
  REVOKE_GRANT_COMMAND_TYPE,
  type RevokeGrantCommandData,
  revokeGrantCommandDataSchema,
  type RoleDefinedPayload,
  ROLE_DEFINED_EVENT_TYPE,
  type RoleDeletedPayload,
  ROLE_DELETED_EVENT_TYPE,
  type RolePermissionsChangedPayload,
  ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
} from "@langwatch/authz-contract";
import {
  type Command,
  type CommandHandler,
  type CommandSchema,
  createTenantId,
  defineAggregate,
  defineCommandSchema,
  defineEvents,
  definePipeline,
  type Event,
  EventUtils,
} from "@langwatch/eventing";
import type { ZodSchema } from "zod";
import { EventingAuthzAuditAdapter } from "./eventing.authz-audit.adapter";
import { AuthzGrantProjection } from "../projections/authz-grant.projection";
import type { GrantProjectionWriteStore } from "../projections/authz-grant.projection";
import type { AuthzAuditTrailStore } from "./eventing.authz-audit.adapter";

/**
 * Both grants and roles use this one Eventing partition. Their aggregate IDs
 * remain the individual grant or role IDs; the organization is their tenant.
 */
export const AUTHZ_GRANT_PIPELINE_NAME = "authz_grant" as const;
export const AUTHZ_GRANT_AGGREGATE_TYPE = "authz_grant" as const;

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

type AuthzEvent<Type extends string, Payload> = Event<Payload> & {
  type: Type;
};

export type GrantAttachedEvent = AuthzEvent<
  typeof GRANT_ATTACHED_EVENT_TYPE,
  GrantAttachedPayload
>;
export type GrantRoleChangedEvent = AuthzEvent<
  typeof GRANT_ROLE_CHANGED_EVENT_TYPE,
  GrantRoleChangedPayload
>;
export type GrantRevokedEvent = AuthzEvent<
  typeof GRANT_REVOKED_EVENT_TYPE,
  GrantRevokedPayload
>;
export type RoleDefinedEvent = AuthzEvent<
  typeof ROLE_DEFINED_EVENT_TYPE,
  RoleDefinedPayload
>;
export type RolePermissionsChangedEvent = AuthzEvent<
  typeof ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
  RolePermissionsChangedPayload
>;
export type RoleDeletedEvent = AuthzEvent<
  typeof ROLE_DELETED_EVENT_TYPE,
  RoleDeletedPayload
>;

export type AuthzGrantsEvent =
  | GrantAttachedEvent
  | GrantRoleChangedEvent
  | GrantRevokedEvent
  | RoleDefinedEvent
  | RolePermissionsChangedEvent
  | RoleDeletedEvent;

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

  handle(
    command: Command<ChangeRolePermissionsCommandData>,
  ): RolePermissionsChangedEvent[] {
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

export interface EventingAuthzAdapterOptions {
  authzGrantsWriteStore: GrantProjectionWriteStore;
  authzAuditTrailStore: AuthzAuditTrailStore;
}

/**
 * Explicit composition boundary for the AuthZ Eventing topology. Importing
 * this module creates no pipeline and registers nothing with a runtime.
 */
export class EventingAuthzAdapter {
  private constructor(private readonly options: EventingAuthzAdapterOptions) {}

  static create(options: EventingAuthzAdapterOptions): EventingAuthzAdapter {
    return new EventingAuthzAdapter(options);
  }

  static build(options: EventingAuthzAdapterOptions) {
    return EventingAuthzAdapter.create(options).build();
  }

  build() {
    return definePipeline<AuthzGrantsEvent>({
      name: AUTHZ_GRANT_PIPELINE_NAME,
      aggregate: defineAggregate({
        type: AUTHZ_GRANT_AGGREGATE_TYPE,
        events: defineEvents(AUTHZ_GRANTS_EVENT_TYPES),
      }),
    })
      .withClickHouseMapProjection(
        AuthzGrantProjection.create(this.options.authzGrantsWriteStore),
      )
      .withEventSubscriber(
        "auditTrail",
        EventingAuthzAuditAdapter.create({
          store: this.options.authzAuditTrailStore,
        }),
      )
      // ADR-114 (amended): every command about ONE grant rides ONE lane.
      // `serializeByAggregate` keys the lane on the grant id AND drops the
      // command NAME from the job path, so `attachGrant` and the `revokeGrant`
      // that follows it queue behind each other instead of racing in two lanes.
      //
      // The projection's guard cannot recover that order on its own. `revoked`
      // is a conditional UPDATE: a revoke that arrives before the row exists
      // matches nothing and writes nothing, and the late `attached` then
      // inserts a live row that no revocation contradicts. Ordering is the
      // queue's job, and this option is what makes the queue do it.
      //
      // The batch bound means something narrower than a throughput lever: it
      // folds ONE grant's own queued same-command jobs into a single insert —
      // the `serializeByAggregate` shape `queueManager` names, safe precisely
      // because those jobs share an aggregate. It buys no cross-grant economy,
      // and is not meant to.
      .withCommand("attachGrant", AttachGrantCommand, {
        serializeByAggregate: true,
        coalesceMaxBatch: GRANT_COALESCE_MAX_BATCH,
      })
      .withCommand("changeGrantRole", ChangeGrantRoleCommand, {
        serializeByAggregate: true,
        coalesceMaxBatch: GRANT_COALESCE_MAX_BATCH,
      })
      .withCommand("revokeGrant", RevokeGrantCommand, {
        serializeByAggregate: true,
        coalesceMaxBatch: GRANT_COALESCE_MAX_BATCH,
      })
      .withCommand("defineRole", DefineRoleCommand)
      .withCommand("changeRolePermissions", ChangeRolePermissionsCommand)
      .withCommand("deleteRole", DeleteRoleCommand)
      .build();
  }
}
