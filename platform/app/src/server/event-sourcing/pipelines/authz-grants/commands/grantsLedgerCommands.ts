import { createTenantId, defineCommandSchema, EventUtils } from "../../..";
import type { Command, CommandHandler } from "../../../commands/command";
import {
  type AttachGrantsCommandData,
  attachGrantsCommandDataSchema,
  type CompleteCutoverCommandData,
  completeCutoverCommandDataSchema,
  type ProveMigrationParityCommandData,
  proveMigrationParityCommandDataSchema,
  type RecordMigrationTenantStateCommandData,
  type RollBackCutoverCommandData,
  recordMigrationTenantStateCommandDataSchema,
  rollBackCutoverCommandDataSchema,
} from "../schemas/commands";
import {
  ATTACH_GRANTS_COMMAND_TYPE,
  AUTHZ_GRANTS_AGGREGATE_TYPE,
  AUTHZ_GRANTS_EVENT_VERSION_LATEST,
  COMPLETE_CUTOVER_COMMAND_TYPE,
  CUTOVER_COMPLETED_EVENT_TYPE,
  CUTOVER_ROLLED_BACK_EVENT_TYPE,
  GRANT_ATTACHED_EVENT_TYPE,
  MIGRATION_PARITY_PROVED_EVENT_TYPE,
  MIGRATION_TENANT_STATE_CHANGED_EVENT_TYPE,
  PROVE_MIGRATION_PARITY_COMMAND_TYPE,
  RECORD_MIGRATION_TENANT_STATE_COMMAND_TYPE,
  ROLL_BACK_CUTOVER_COMMAND_TYPE,
} from "../schemas/constants";
import type {
  CutoverCompletedEvent,
  CutoverRolledBackEvent,
  GrantAttachedEvent,
  MigrationParityProvedEvent,
  MigrationTenantStateChangedEvent,
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
