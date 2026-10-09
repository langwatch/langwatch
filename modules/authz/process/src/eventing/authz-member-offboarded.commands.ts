import { AUTHZ_MEMBER_OFFBOARDED_EVENT_TYPE } from "@langwatch/authz-contract";
import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";

import {
  AUTHZ_MEMBER_OFFBOARDED_AGGREGATE_TYPE,
  AUTHZ_MEMBER_OFFBOARDED_EVENT_VERSION,
  type AuthzMemberOffboardedEvent,
  RECORD_MEMBER_OFFBOARDED_COMMAND_TYPE,
  type RecordMemberOffboardedCommandData,
  recordMemberOffboardedCommandDataSchema,
} from "./authz-member-offboarded.events.ts";

/**
 * Records that a proven offboarding took a member's seat. The stream is the member, and a
 * redelivered command for the same moment records nothing new.
 */
export class RecordMemberOffboardedCommand implements CommandHandler<
  Command<RecordMemberOffboardedCommandData>,
  AuthzMemberOffboardedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_MEMBER_OFFBOARDED_COMMAND_TYPE,
    recordMemberOffboardedCommandDataSchema,
    "Record that a member was offboarded from an organization",
  );

  async handle(
    command: Command<RecordMemberOffboardedCommandData>,
  ): Promise<AuthzMemberOffboardedEvent[]> {
    const data = command.data;
    return [
      EventUtils.createEvent<AuthzMemberOffboardedEvent>({
        aggregateType: AUTHZ_MEMBER_OFFBOARDED_AGGREGATE_TYPE,
        aggregateId: data.userId,
        tenantId: createTenantId(command.tenantId),
        type: AUTHZ_MEMBER_OFFBOARDED_EVENT_TYPE,
        version: AUTHZ_MEMBER_OFFBOARDED_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:${data.userId}:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordMemberOffboardedCommandData): string {
    return payload.userId;
  }

  static getSpanAttributes(
    payload: RecordMemberOffboardedCommandData,
  ): Record<string, string | number | boolean> {
    return { "payload.organization.id": payload.organizationId };
  }
}
