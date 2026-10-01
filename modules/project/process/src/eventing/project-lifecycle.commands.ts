import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";
import {
  PROJECT_AGGREGATE_TYPE,
  PROJECT_CREATED_EVENT_TYPE,
  PROJECT_CREATED_EVENT_VERSION,
} from "@langwatch/project-contract";

import {
  RECORD_PROJECT_CREATED_COMMAND_TYPE,
  type ProjectCreatedEvent,
  type RecordProjectCreatedCommandData,
  recordProjectCreatedCommandDataSchema,
} from "./project-lifecycle.events.ts";

/** Records that a project exists. A project is created once, so a redelivery records nothing new. */
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
