import { AUTHZ_AGGREGATE_READ_EVENT_TYPE } from "@langwatch/authz-contract";
import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";

import {
  AUTHZ_AGGREGATE_READ_AGGREGATE_TYPE,
  AUTHZ_AGGREGATE_READ_EVENT_VERSION,
  type AuthzAggregateReadEvent,
  RECORD_AGGREGATE_READ_COMMAND_TYPE,
  type RecordAggregateReadCommandData,
  recordAggregateReadCommandDataSchema,
} from "./authz-aggregate-read.events.ts";

/**
 * Records that a user read an aggregate project. The stream is the aggregate project, and a
 * redelivered command for the same moment records nothing new.
 */
export class RecordAggregateReadCommand implements CommandHandler<
  Command<RecordAggregateReadCommandData>,
  AuthzAggregateReadEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_AGGREGATE_READ_COMMAND_TYPE,
    recordAggregateReadCommandDataSchema,
    "Record that a user read an aggregate project",
  );

  async handle(
    command: Command<RecordAggregateReadCommandData>,
  ): Promise<AuthzAggregateReadEvent[]> {
    const data = command.data;
    return [
      EventUtils.createEvent<AuthzAggregateReadEvent>({
        aggregateType: AUTHZ_AGGREGATE_READ_AGGREGATE_TYPE,
        aggregateId: data.aggregateProjectId,
        tenantId: createTenantId(command.tenantId),
        type: AUTHZ_AGGREGATE_READ_EVENT_TYPE,
        version: AUTHZ_AGGREGATE_READ_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.aggregateProjectId}:${data.actorUserId}:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordAggregateReadCommandData): string {
    return payload.aggregateProjectId;
  }

  static getSpanAttributes(
    payload: RecordAggregateReadCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.organization.id": payload.organizationId,
      "payload.project.id": payload.aggregateProjectId,
    };
  }
}
