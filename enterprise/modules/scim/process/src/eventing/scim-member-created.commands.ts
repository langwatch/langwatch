// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  SCIM_MEMBER_CREATED_EVENT_TYPE,
  SCIM_MEMBER_CREATED_EVENT_VERSION,
  SCIM_MEMBERSHIP_AGGREGATE_TYPE,
} from "@langwatch/enterprise-scim-contract";
import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";

import {
  RECORD_MEMBER_CREATED_COMMAND_TYPE,
  type RecordMemberCreatedCommandData,
  recordMemberCreatedCommandDataSchema,
  type ScimMemberCreatedEvent,
} from "./scim-member-created.events.ts";

/**
 * Records a membership a directory create wrote, as the outbox delivers it. The create's own id
 * keys the event, so a redelivered intent records nothing new.
 */
export class RecordMemberCreatedCommand implements CommandHandler<
  Command<RecordMemberCreatedCommandData>,
  ScimMemberCreatedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_MEMBER_CREATED_COMMAND_TYPE,
    recordMemberCreatedCommandDataSchema,
    "Record a membership a SCIM directory create wrote, and the seat it took",
  );

  handle(command: Command<RecordMemberCreatedCommandData>): ScimMemberCreatedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<ScimMemberCreatedEvent>({
        aggregateType: SCIM_MEMBERSHIP_AGGREGATE_TYPE,
        aggregateId: data.userId,
        tenantId: createTenantId(command.tenantId),
        type: SCIM_MEMBER_CREATED_EVENT_TYPE,
        version: SCIM_MEMBER_CREATED_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: data.createId,
      }),
    ];
  }

  static getAggregateId(payload: RecordMemberCreatedCommandData): string {
    return payload.userId;
  }

  static getSpanAttributes(
    payload: RecordMemberCreatedCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.organization.id": payload.organizationId,
      "payload.user.id": payload.userId,
    };
  }
}
