import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";
import {
  USER_AGGREGATE_TYPE,
  USER_DEACTIVATED_EVENT_TYPE,
  USER_LIFECYCLE_EVENT_VERSION,
  USER_REACTIVATED_EVENT_TYPE,
} from "@langwatch/user-contract";

import {
  RECORD_USER_DEACTIVATED_COMMAND_TYPE,
  RECORD_USER_REACTIVATED_COMMAND_TYPE,
  type RecordUserLifecycleCommandData,
  recordUserLifecycleCommandDataSchema,
  type UserDeactivatedEvent,
  type UserReactivatedEvent,
} from "./user-lifecycle.events.ts";

function spanAttributes(
  payload: RecordUserLifecycleCommandData,
): Record<string, string | number | boolean> {
  return { "payload.user.id": payload.userId };
}

/** Records that an account was deactivated; keyed on its instant, so a redelivery records nothing new. */
export class RecordUserDeactivatedCommand implements CommandHandler<
  Command<RecordUserLifecycleCommandData>,
  UserDeactivatedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_USER_DEACTIVATED_COMMAND_TYPE,
    recordUserLifecycleCommandDataSchema,
    "Record that a user was deactivated",
  );

  async handle(command: Command<RecordUserLifecycleCommandData>): Promise<UserDeactivatedEvent[]> {
    const data = command.data;
    return [
      EventUtils.createEvent<UserDeactivatedEvent>({
        aggregateType: USER_AGGREGATE_TYPE,
        aggregateId: data.userId,
        tenantId: createTenantId(command.tenantId),
        type: USER_DEACTIVATED_EVENT_TYPE,
        version: USER_LIFECYCLE_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.userId}:deactivated:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordUserLifecycleCommandData): string {
    return payload.userId;
  }

  static getSpanAttributes = spanAttributes;
}

/** Records that an account was reactivated; keyed on its instant, so a redelivery records nothing new. */
export class RecordUserReactivatedCommand implements CommandHandler<
  Command<RecordUserLifecycleCommandData>,
  UserReactivatedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_USER_REACTIVATED_COMMAND_TYPE,
    recordUserLifecycleCommandDataSchema,
    "Record that a user was reactivated",
  );

  async handle(command: Command<RecordUserLifecycleCommandData>): Promise<UserReactivatedEvent[]> {
    const data = command.data;
    return [
      EventUtils.createEvent<UserReactivatedEvent>({
        aggregateType: USER_AGGREGATE_TYPE,
        aggregateId: data.userId,
        tenantId: createTenantId(command.tenantId),
        type: USER_REACTIVATED_EVENT_TYPE,
        version: USER_LIFECYCLE_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.userId}:reactivated:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordUserLifecycleCommandData): string {
    return payload.userId;
  }

  static getSpanAttributes = spanAttributes;
}
