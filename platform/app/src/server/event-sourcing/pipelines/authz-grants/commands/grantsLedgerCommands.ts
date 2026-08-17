import { createTenantId, defineCommandSchema, EventUtils } from "../../..";
import type { Command, CommandHandler } from "../../../commands/command";
import {
  type AttachGrantsCommandData,
  attachGrantsCommandDataSchema,
  type ChangeGrantRoleCommandData,
  changeGrantRoleCommandDataSchema,
  type CompleteCutoverCommandData,
  completeCutoverCommandDataSchema,
  type DefineRolesCommandData,
  type DeleteRoleCommandData,
  defineRolesCommandDataSchema,
  deleteRoleCommandDataSchema,
  type OffboardMemberCommandData,
  offboardMemberCommandDataSchema,
  type ProveMigrationParityCommandData,
  proveMigrationParityCommandDataSchema,
  type RecordMigrationTenantStateCommandData,
  type RevokeGrantsCommandData,
  type RollBackCutoverCommandData,
  recordMigrationTenantStateCommandDataSchema,
  revokeGrantsCommandDataSchema,
  rollBackCutoverCommandDataSchema,
} from "../schemas/commands";
import {
  ATTACH_GRANTS_COMMAND_TYPE,
  AUTHZ_GRANTS_AGGREGATE_TYPE,
  AUTHZ_GRANTS_EVENT_VERSION_LATEST,
  CHANGE_GRANT_ROLE_COMMAND_TYPE,
  COMPLETE_CUTOVER_COMMAND_TYPE,
  CUTOVER_COMPLETED_EVENT_TYPE,
  CUTOVER_ROLLED_BACK_EVENT_TYPE,
  DEFINE_ROLES_COMMAND_TYPE,
  DELETE_ROLE_COMMAND_TYPE,
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
  MEMBER_OFFBOARDED_EVENT_TYPE,
  MIGRATION_PARITY_PROVED_EVENT_TYPE,
  MIGRATION_TENANT_STATE_CHANGED_EVENT_TYPE,
  OFFBOARD_MEMBER_COMMAND_TYPE,
  PROVE_MIGRATION_PARITY_COMMAND_TYPE,
  RECORD_MIGRATION_TENANT_STATE_COMMAND_TYPE,
  REVOKE_GRANTS_COMMAND_TYPE,
  ROLE_DEFINED_EVENT_TYPE,
  ROLE_DELETED_EVENT_TYPE,
  ROLL_BACK_CUTOVER_COMMAND_TYPE,
} from "../schemas/constants";
import type {
  CutoverCompletedEvent,
  CutoverRolledBackEvent,
  GrantAttachedEvent,
  GrantRevokedEvent,
  GrantRoleChangedEvent,
  MemberOffboardedEvent,
  MigrationParityProvedEvent,
  MigrationTenantStateChangedEvent,
  RoleDefinedEvent,
  RoleDeletedEvent,
} from "../schemas/events";

/**
 * The grants ledger's commands are pure appends: validate, stamp identity,
 * emit. `aggregateId = organizationId` on every event, and every event's
 * `idempotencyKey` is `<commandId>:<index>` (decision 23) so a retried
 * command dedupes at the event store while distinct actions never collide.
 *
 * `attachGrants` is the batched writer the migrations ride (decision 9):
 * one command, one event per fact, one store call — each event's
 * `occurredAt` carries that fact's OWN business time, which is how a
 * backfilled grant keeps the legacy row's createdAt while `createdAt`
 * (ledger-accepted time) stays honest.
 */

function eventIdempotencyKey({
  commandId,
  index,
}: {
  commandId: string;
  index: number;
}): string {
  return `${commandId}:${index}`;
}

export class AttachGrantsCommand
  implements
    CommandHandler<Command<AttachGrantsCommandData>, GrantAttachedEvent>
{
  static readonly schema = defineCommandSchema(
    ATTACH_GRANTS_COMMAND_TYPE,
    attachGrantsCommandDataSchema,
    "Record a batch of access facts for one organization",
  );

  static getAggregateId(payload: AttachGrantsCommandData): string {
    return payload.organizationId;
  }

  async handle(
    command: Command<AttachGrantsCommandData>,
  ): Promise<GrantAttachedEvent[]> {
    const { organizationId, commandId, grants } = command.data;
    return grants.map(({ occurredAtMs, ...grant }, index) =>
      EventUtils.createEvent<GrantAttachedEvent>({
        aggregateType: AUTHZ_GRANTS_AGGREGATE_TYPE,
        aggregateId: organizationId,
        tenantId: createTenantId(command.tenantId),
        type: GRANT_ATTACHED_EVENT_TYPE,
        version: AUTHZ_GRANTS_EVENT_VERSION_LATEST,
        data: grant,
        metadata: {},
        occurredAt: occurredAtMs,
        idempotencyKey: eventIdempotencyKey({ commandId, index }),
      }),
    );
  }
}

export class ChangeGrantRoleCommand
  implements
    CommandHandler<Command<ChangeGrantRoleCommandData>, GrantRoleChangedEvent>
{
  static readonly schema = defineCommandSchema(
    CHANGE_GRANT_ROLE_COMMAND_TYPE,
    changeGrantRoleCommandDataSchema,
    "Change the role one grant carries, keeping the grant's identity",
  );

  static getAggregateId(payload: ChangeGrantRoleCommandData): string {
    return payload.organizationId;
  }

  async handle(
    command: Command<ChangeGrantRoleCommandData>,
  ): Promise<GrantRoleChangedEvent[]> {
    const { organizationId, commandId, grantId, from, to, actor } =
      command.data;
    return [
      EventUtils.createEvent<GrantRoleChangedEvent>({
        aggregateType: AUTHZ_GRANTS_AGGREGATE_TYPE,
        aggregateId: organizationId,
        tenantId: createTenantId(command.tenantId),
        type: GRANT_ROLE_CHANGED_EVENT_TYPE,
        version: AUTHZ_GRANTS_EVENT_VERSION_LATEST,
        data: { grantId, from, to, actor },
        metadata: {},
        occurredAt: command.data.occurredAtMs,
        idempotencyKey: eventIdempotencyKey({ commandId, index: 0 }),
      }),
    ];
  }
}

export class RevokeGrantsCommand
  implements
    CommandHandler<Command<RevokeGrantsCommandData>, GrantRevokedEvent>
{
  static readonly schema = defineCommandSchema(
    REVOKE_GRANTS_COMMAND_TYPE,
    revokeGrantsCommandDataSchema,
    "Revoke a batch of grants for one organization",
  );

  static getAggregateId(payload: RevokeGrantsCommandData): string {
    return payload.organizationId;
  }

  async handle(
    command: Command<RevokeGrantsCommandData>,
  ): Promise<GrantRevokedEvent[]> {
    const { organizationId, commandId, revocations, actor } = command.data;
    return revocations.map(({ grantId, reason }, index) =>
      EventUtils.createEvent<GrantRevokedEvent>({
        aggregateType: AUTHZ_GRANTS_AGGREGATE_TYPE,
        aggregateId: organizationId,
        tenantId: createTenantId(command.tenantId),
        type: GRANT_REVOKED_EVENT_TYPE,
        version: AUTHZ_GRANTS_EVENT_VERSION_LATEST,
        data: { grantId, ...(reason ? { reason } : {}), actor },
        metadata: {},
        occurredAt: command.data.occurredAtMs,
        idempotencyKey: eventIdempotencyKey({ commandId, index }),
      }),
    );
  }
}

export class DefineRolesCommand
  implements CommandHandler<Command<DefineRolesCommandData>, RoleDefinedEvent>
{
  static readonly schema = defineCommandSchema(
    DEFINE_ROLES_COMMAND_TYPE,
    defineRolesCommandDataSchema,
    "Record a batch of role definitions for one organization",
  );

  static getAggregateId(payload: DefineRolesCommandData): string {
    return payload.organizationId;
  }

  async handle(
    command: Command<DefineRolesCommandData>,
  ): Promise<RoleDefinedEvent[]> {
    const { organizationId, commandId, roles, actor } = command.data;
    return roles.map(({ occurredAtMs, ...role }, index) =>
      EventUtils.createEvent<RoleDefinedEvent>({
        aggregateType: AUTHZ_GRANTS_AGGREGATE_TYPE,
        aggregateId: organizationId,
        tenantId: createTenantId(command.tenantId),
        type: ROLE_DEFINED_EVENT_TYPE,
        version: AUTHZ_GRANTS_EVENT_VERSION_LATEST,
        data: { ...role, actor },
        metadata: {},
        occurredAt: occurredAtMs,
        idempotencyKey: eventIdempotencyKey({ commandId, index }),
      }),
    );
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
    return payload.organizationId;
  }

  async handle(
    command: Command<DeleteRoleCommandData>,
  ): Promise<RoleDeletedEvent[]> {
    const { organizationId, commandId, roleId, actor } = command.data;
    return [
      EventUtils.createEvent<RoleDeletedEvent>({
        aggregateType: AUTHZ_GRANTS_AGGREGATE_TYPE,
        aggregateId: organizationId,
        tenantId: createTenantId(command.tenantId),
        type: ROLE_DELETED_EVENT_TYPE,
        version: AUTHZ_GRANTS_EVENT_VERSION_LATEST,
        data: { roleId, actor },
        metadata: {},
        occurredAt: command.data.occurredAtMs,
        idempotencyKey: eventIdempotencyKey({ commandId, index: 0 }),
      }),
    ];
  }
}

export class OffboardMemberCommand
  implements
    CommandHandler<Command<OffboardMemberCommandData>, MemberOffboardedEvent>
{
  static readonly schema = defineCommandSchema(
    OFFBOARD_MEMBER_COMMAND_TYPE,
    offboardMemberCommandDataSchema,
    "Record one member's offboarding and the grants it revoked",
  );

  static getAggregateId(payload: OffboardMemberCommandData): string {
    return payload.organizationId;
  }

  async handle(
    command: Command<OffboardMemberCommandData>,
  ): Promise<MemberOffboardedEvent[]> {
    const { organizationId, commandId, userId, revokedGrantIds, actor } =
      command.data;
    return [
      EventUtils.createEvent<MemberOffboardedEvent>({
        aggregateType: AUTHZ_GRANTS_AGGREGATE_TYPE,
        aggregateId: organizationId,
        tenantId: createTenantId(command.tenantId),
        type: MEMBER_OFFBOARDED_EVENT_TYPE,
        version: AUTHZ_GRANTS_EVENT_VERSION_LATEST,
        data: { userId, revokedGrantIds, actor },
        metadata: {},
        occurredAt: command.data.occurredAtMs,
        idempotencyKey: eventIdempotencyKey({ commandId, index: 0 }),
      }),
    ];
  }
}

export class ProveMigrationParityCommand
  implements
    CommandHandler<
      Command<ProveMigrationParityCommandData>,
      MigrationParityProvedEvent
    >
{
  static readonly schema = defineCommandSchema(
    PROVE_MIGRATION_PARITY_COMMAND_TYPE,
    proveMigrationParityCommandDataSchema,
    "Record a per-organization parity proof; an empty diff list means clean",
  );

  static getAggregateId(payload: ProveMigrationParityCommandData): string {
    return payload.organizationId;
  }

  async handle(
    command: Command<ProveMigrationParityCommandData>,
  ): Promise<MigrationParityProvedEvent[]> {
    const { organizationId, commandId, diffs } = command.data;
    return [
      EventUtils.createEvent<MigrationParityProvedEvent>({
        aggregateType: AUTHZ_GRANTS_AGGREGATE_TYPE,
        aggregateId: organizationId,
        tenantId: createTenantId(command.tenantId),
        type: MIGRATION_PARITY_PROVED_EVENT_TYPE,
        version: AUTHZ_GRANTS_EVENT_VERSION_LATEST,
        data: { diffs },
        metadata: {},
        occurredAt: command.data.occurredAtMs,
        idempotencyKey: eventIdempotencyKey({ commandId, index: 0 }),
      }),
    ];
  }
}

export class CompleteCutoverCommand
  implements
    CommandHandler<Command<CompleteCutoverCommandData>, CutoverCompletedEvent>
{
  static readonly schema = defineCommandSchema(
    COMPLETE_CUTOVER_COMMAND_TYPE,
    completeCutoverCommandDataSchema,
    "Flip one organization onto the engine after a clean parity proof",
  );

  static getAggregateId(payload: CompleteCutoverCommandData): string {
    return payload.organizationId;
  }

  async handle(
    command: Command<CompleteCutoverCommandData>,
  ): Promise<CutoverCompletedEvent[]> {
    const { organizationId, commandId, actor } = command.data;
    return [
      EventUtils.createEvent<CutoverCompletedEvent>({
        aggregateType: AUTHZ_GRANTS_AGGREGATE_TYPE,
        aggregateId: organizationId,
        tenantId: createTenantId(command.tenantId),
        type: CUTOVER_COMPLETED_EVENT_TYPE,
        version: AUTHZ_GRANTS_EVENT_VERSION_LATEST,
        data: { actor },
        metadata: {},
        occurredAt: command.data.occurredAtMs,
        idempotencyKey: eventIdempotencyKey({ commandId, index: 0 }),
      }),
    ];
  }
}

export class RollBackCutoverCommand
  implements
    CommandHandler<Command<RollBackCutoverCommandData>, CutoverRolledBackEvent>
{
  static readonly schema = defineCommandSchema(
    ROLL_BACK_CUTOVER_COMMAND_TYPE,
    rollBackCutoverCommandDataSchema,
    "Put one organization back on its legacy path",
  );

  static getAggregateId(payload: RollBackCutoverCommandData): string {
    return payload.organizationId;
  }

  async handle(
    command: Command<RollBackCutoverCommandData>,
  ): Promise<CutoverRolledBackEvent[]> {
    const { organizationId, commandId, actor, reason } = command.data;
    return [
      EventUtils.createEvent<CutoverRolledBackEvent>({
        aggregateType: AUTHZ_GRANTS_AGGREGATE_TYPE,
        aggregateId: organizationId,
        tenantId: createTenantId(command.tenantId),
        type: CUTOVER_ROLLED_BACK_EVENT_TYPE,
        version: AUTHZ_GRANTS_EVENT_VERSION_LATEST,
        data: { actor, reason },
        metadata: {},
        occurredAt: command.data.occurredAtMs,
        idempotencyKey: eventIdempotencyKey({ commandId, index: 0 }),
      }),
    ];
  }
}

export class RecordMigrationTenantStateCommand
  implements
    CommandHandler<
      Command<RecordMigrationTenantStateCommandData>,
      MigrationTenantStateChangedEvent
    >
{
  static readonly schema = defineCommandSchema(
    RECORD_MIGRATION_TENANT_STATE_COMMAND_TYPE,
    recordMigrationTenantStateCommandDataSchema,
    "Witness one runner lifecycle transition for one organization",
  );

  static getAggregateId(
    payload: RecordMigrationTenantStateCommandData,
  ): string {
    return payload.organizationId;
  }

  async handle(
    command: Command<RecordMigrationTenantStateCommandData>,
  ): Promise<MigrationTenantStateChangedEvent[]> {
    const { organizationId, commandId, migrationName, status, report, actor } =
      command.data;
    return [
      EventUtils.createEvent<MigrationTenantStateChangedEvent>({
        aggregateType: AUTHZ_GRANTS_AGGREGATE_TYPE,
        aggregateId: organizationId,
        tenantId: createTenantId(command.tenantId),
        type: MIGRATION_TENANT_STATE_CHANGED_EVENT_TYPE,
        version: AUTHZ_GRANTS_EVENT_VERSION_LATEST,
        data: { migrationName, status, report, actor },
        metadata: {},
        occurredAt: command.data.occurredAtMs,
        idempotencyKey: eventIdempotencyKey({ commandId, index: 0 }),
      }),
    ];
  }
}
