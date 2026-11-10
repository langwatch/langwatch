import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";

import type { DataRetentionService } from "../services/data-retention.service.ts";
import {
  type ApplyRetentionExtensionCommandData,
  APPLY_RETENTION_EXTENSION_COMMAND_TYPE,
  applyRetentionExtensionCommandDataSchema,
  type RecordRetentionExtensionCommandData,
  RECORD_RETENTION_EXTENSION_COMMAND_TYPE,
  recordRetentionExtensionCommandDataSchema,
  RETENTION_APPLIED_EVENT_TYPE,
  RETENTION_EXTENDED_EVENT_TYPE,
  RETENTION_EXTENSION_AGGREGATE_TYPE,
  RETENTION_EXTENSION_EVENT_VERSION,
  type RetentionAppliedEvent,
  type RetentionExtendedEvent,
} from "./retention-extension.events.ts";

/** Records an organization's lengthened retention once per activation, keyed by its identity. */
export class RecordRetentionExtensionCommand implements CommandHandler<
  Command<RecordRetentionExtensionCommandData>,
  RetentionExtendedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_RETENTION_EXTENSION_COMMAND_TYPE,
    recordRetentionExtensionCommandDataSchema,
    "Record an organization's retention as a paid activation left it",
  );

  async handle(
    command: Command<RecordRetentionExtensionCommandData>,
  ): Promise<RetentionExtendedEvent[]> {
    const data = {
      organizationId: command.data.organizationId,
      extensionId: command.data.extensionId,
      retention: command.data.retention,
      extendedAt: command.data.extendedAt,
    };
    return [
      EventUtils.createEvent<RetentionExtendedEvent>({
        aggregateType: RETENTION_EXTENSION_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: RETENTION_EXTENDED_EVENT_TYPE,
        version: RETENTION_EXTENSION_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.extendedAt,
        idempotencyKey: `retention-extended:${data.extensionId}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordRetentionExtensionCommandData): string {
    return payload.organizationId;
  }

  static getSpanAttributes(payload: RecordRetentionExtensionCommandData): Record<string, string> {
    return {
      "payload.organization.id": payload.organizationId,
      "payload.retention_extension.id": payload.extensionId,
    };
  }
}

/**
 * Raises one project's stored rows in one category to its resolved retention and records it. A
 * rewrite still running on those rows throws, so the command is retried until it applies.
 */
export class ApplyRetentionExtensionCommand implements CommandHandler<
  Command<ApplyRetentionExtensionCommandData>,
  RetentionAppliedEvent
> {
  static readonly schema = defineCommandSchema(
    APPLY_RETENTION_EXTENSION_COMMAND_TYPE,
    applyRetentionExtensionCommandDataSchema,
    "Raise one project's stored rows to its lengthened retention",
  );

  private constructor(
    private readonly retention: Pick<DataRetentionService, "raiseStoredRetention">,
  ) {}

  static create({
    retention,
  }: {
    retention: Pick<DataRetentionService, "raiseStoredRetention">;
  }): ApplyRetentionExtensionCommand {
    return new ApplyRetentionExtensionCommand(retention);
  }

  async handle(
    command: Command<ApplyRetentionExtensionCommandData>,
  ): Promise<RetentionAppliedEvent[]> {
    const { organizationId, projectId, extensionId, category, occurredAt } = command.data;
    const { tables, retentionDays } = await this.retention.raiseStoredRetention({
      projectId,
      category,
    });
    return [
      EventUtils.createEvent<RetentionAppliedEvent>({
        aggregateType: RETENTION_EXTENSION_AGGREGATE_TYPE,
        aggregateId: projectId,
        tenantId: createTenantId(command.tenantId),
        type: RETENTION_APPLIED_EVENT_TYPE,
        version: RETENTION_EXTENSION_EVENT_VERSION,
        data: {
          organizationId,
          projectId,
          extensionId,
          category,
          retentionDays,
          tables,
          appliedAt: occurredAt,
        },
        metadata: {},
        occurredAt,
        idempotencyKey: `retention-applied:${extensionId}:${projectId}:${category}`,
      }),
    ];
  }

  static getAggregateId(payload: ApplyRetentionExtensionCommandData): string {
    return payload.projectId;
  }

  static getSpanAttributes(payload: ApplyRetentionExtensionCommandData): Record<string, string> {
    return {
      "payload.organization.id": payload.organizationId,
      "payload.project.id": payload.projectId,
      "payload.retention.category": payload.category,
    };
  }
}
