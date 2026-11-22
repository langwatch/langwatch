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
  REQUEST_STORED_RETENTION_APPLY_COMMAND_TYPE,
  type RequestStoredRetentionApplyCommandData,
  requestStoredRetentionApplyCommandDataSchema,
  STORED_RETENTION_APPLY_REQUESTED_EVENT_TYPE,
  type StoredRetentionApplyRequestedEvent,
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
      ...(command.data.scope ? { scope: command.data.scope } : {}),
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

type StoredRetentionWriter = Pick<
  DataRetentionService,
  "raiseStoredRetention" | "applyStoredRetention"
>;

/** Records an admin's ask to apply the scope's periods to stored data, once per request. */
export class RequestStoredRetentionApplyCommand implements CommandHandler<
  Command<RequestStoredRetentionApplyCommandData>,
  StoredRetentionApplyRequestedEvent
> {
  static readonly schema = defineCommandSchema(
    REQUEST_STORED_RETENTION_APPLY_COMMAND_TYPE,
    requestStoredRetentionApplyCommandDataSchema,
    "Record an ask to apply a scope's retention to its stored data",
  );

  async handle(
    command: Command<RequestStoredRetentionApplyCommandData>,
  ): Promise<StoredRetentionApplyRequestedEvent[]> {
    const { organizationId, requestId, scope, categories, requestedAt } = command.data;
    return [
      EventUtils.createEvent<StoredRetentionApplyRequestedEvent>({
        aggregateType: RETENTION_EXTENSION_AGGREGATE_TYPE,
        aggregateId: organizationId,
        tenantId: createTenantId(command.tenantId),
        type: STORED_RETENTION_APPLY_REQUESTED_EVENT_TYPE,
        version: RETENTION_EXTENSION_EVENT_VERSION,
        data: { organizationId, requestId, scope, categories, requestedAt },
        metadata: {},
        occurredAt: requestedAt,
        idempotencyKey: `stored-retention-apply:${requestId}`,
      }),
    ];
  }

  static getAggregateId(payload: RequestStoredRetentionApplyCommandData): string {
    return payload.organizationId;
  }

  static getSpanAttributes(
    payload: RequestStoredRetentionApplyCommandData,
  ): Record<string, string> {
    return {
      "payload.organization.id": payload.organizationId,
      "payload.retention_apply.id": payload.requestId,
    };
  }
}

/**
 * Raises (or, asked to apply, rewrites) one project's stored rows in one category to its resolved
 * retention and records it. A
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

  private constructor(private readonly retention: StoredRetentionWriter) {}

  static create({
    retention,
  }: {
    retention: StoredRetentionWriter;
  }): ApplyRetentionExtensionCommand {
    return new ApplyRetentionExtensionCommand(retention);
  }

  async handle(
    command: Command<ApplyRetentionExtensionCommandData>,
  ): Promise<RetentionAppliedEvent[]> {
    const { organizationId, projectId, extensionId, category, occurredAt } = command.data;
    const mode = command.data.mode ?? "raise";
    const { tables, retentionDays } =
      mode === "apply"
        ? await this.retention.applyStoredRetention({ projectId, category })
        : await this.retention.raiseStoredRetention({ projectId, category });
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
          mode,
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
