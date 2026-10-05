import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";
import {
  PROJECT_AGGREGATE_TYPE,
  PROJECT_CREATED_EVENT_TYPE,
  PROJECT_CREATED_EVENT_VERSION,
  PROJECT_LEGACY_KEY_REVOKED_EVENT_TYPE,
  PROJECT_LEGACY_KEY_REVOKED_EVENT_VERSION,
  PROJECT_PRESENCE_SETTING_CHANGED_EVENT_TYPE,
  PROJECT_PRESENCE_SETTING_CHANGED_EVENT_VERSION,
} from "@langwatch/project-contract";

import {
  RECORD_PROJECT_CREATED_COMMAND_TYPE,
  RECORD_PROJECT_LEGACY_KEY_REVOKED_COMMAND_TYPE,
  RECORD_PROJECT_PRESENCE_SETTING_CHANGED_COMMAND_TYPE,
  type ProjectCreatedEvent,
  type ProjectLegacyKeyRevokedEvent,
  type ProjectPresenceSettingChangedEvent,
  type RecordProjectPresenceSettingChangedCommandData,
  recordProjectPresenceSettingChangedCommandDataSchema,
  type RecordProjectLegacyKeyRevokedCommandData,
  recordProjectLegacyKeyRevokedCommandDataSchema,
  type RecordProjectCreatedCommandData,
  recordProjectCreatedCommandDataSchema,
} from "./project-lifecycle.events.ts";

/**
 * Records that a project exists. A project is created once, so a redelivery records nothing new.
 */
export class RecordProjectCreatedCommand implements CommandHandler<
  Command<RecordProjectCreatedCommandData>,
  ProjectCreatedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_PROJECT_CREATED_COMMAND_TYPE,
    recordProjectCreatedCommandDataSchema,
    "Record that a project was created",
  );

  async handle(command: Command<RecordProjectCreatedCommandData>): Promise<ProjectCreatedEvent[]> {
    const data = command.data;
    return [
      EventUtils.createEvent<ProjectCreatedEvent>({
        aggregateType: PROJECT_AGGREGATE_TYPE,
        aggregateId: data.projectId,
        tenantId: createTenantId(command.tenantId),
        type: PROJECT_CREATED_EVENT_TYPE,
        version: PROJECT_CREATED_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.projectId}:created`,
      }),
    ];
  }

  static getAggregateId(payload: RecordProjectCreatedCommandData): string {
    return payload.projectId;
  }

  static getSpanAttributes(
    payload: RecordProjectCreatedCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.project.id": payload.projectId,
      "payload.organization.id": payload.organizationId,
    };
  }
}

/** Records that a project's legacy key was revoked, which is what makes its status read stale. */
export class RecordProjectLegacyKeyRevokedCommand implements CommandHandler<
  Command<RecordProjectLegacyKeyRevokedCommandData>,
  ProjectLegacyKeyRevokedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_PROJECT_LEGACY_KEY_REVOKED_COMMAND_TYPE,
    recordProjectLegacyKeyRevokedCommandDataSchema,
    "Record that a project's legacy key was revoked",
  );

  async handle(
    command: Command<RecordProjectLegacyKeyRevokedCommandData>,
  ): Promise<ProjectLegacyKeyRevokedEvent[]> {
    const data = command.data;
    return [
      EventUtils.createEvent<ProjectLegacyKeyRevokedEvent>({
        aggregateType: PROJECT_AGGREGATE_TYPE,
        aggregateId: data.projectId,
        tenantId: createTenantId(command.tenantId),
        type: PROJECT_LEGACY_KEY_REVOKED_EVENT_TYPE,
        version: PROJECT_LEGACY_KEY_REVOKED_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.projectId}:legacy-key-revoked:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordProjectLegacyKeyRevokedCommandData): string {
    return payload.projectId;
  }

  static getSpanAttributes(
    payload: RecordProjectLegacyKeyRevokedCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.project.id": payload.projectId,
      "payload.organization.id": payload.organizationId,
    };
  }
}

/**
 * Records a project's presence switch. A change is keyed on its moment; a backfill once per
 * project, so a re-run collapses onto the first.
 */
export class RecordProjectPresenceSettingChangedCommand implements CommandHandler<
  Command<RecordProjectPresenceSettingChangedCommandData>,
  ProjectPresenceSettingChangedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_PROJECT_PRESENCE_SETTING_CHANGED_COMMAND_TYPE,
    recordProjectPresenceSettingChangedCommandDataSchema,
    "Record that a project's presence setting changed",
  );

  async handle(
    command: Command<RecordProjectPresenceSettingChangedCommandData>,
  ): Promise<ProjectPresenceSettingChangedEvent[]> {
    const data = command.data;
    return [
      EventUtils.createEvent<ProjectPresenceSettingChangedEvent>({
        aggregateType: PROJECT_AGGREGATE_TYPE,
        aggregateId: data.projectId,
        tenantId: createTenantId(command.tenantId),
        type: PROJECT_PRESENCE_SETTING_CHANGED_EVENT_TYPE,
        version: PROJECT_PRESENCE_SETTING_CHANGED_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: data.backfilled
          ? `${data.projectId}:presence-setting:backfilled`
          : `${data.projectId}:presence-setting:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordProjectPresenceSettingChangedCommandData): string {
    return payload.projectId;
  }

  static getSpanAttributes(
    payload: RecordProjectPresenceSettingChangedCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.project.id": payload.projectId,
      "payload.organization.id": payload.organizationId,
    };
  }
}
