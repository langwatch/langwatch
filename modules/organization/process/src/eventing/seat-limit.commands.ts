import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";
import { SEAT_LIMIT_REACHED_EVENT_TYPE } from "@langwatch/organization-contract";

import {
  RECORD_SEAT_LIMIT_REACHED_COMMAND_TYPE,
  type RecordSeatLimitReachedCommandData,
  recordSeatLimitReachedCommandDataSchema,
  SEAT_LIMIT_AGGREGATE_TYPE,
  SEAT_LIMIT_REACHED_EVENT_VERSION,
  type SeatLimitReachedEvent,
} from "./seat-limit.events.ts";

/**
 * Records that an organization reached a seat limit. The aggregate is the organization, and a
 * redelivered command for the same moment records nothing new.
 */
export class RecordSeatLimitReachedCommand implements CommandHandler<
  Command<RecordSeatLimitReachedCommandData>,
  SeatLimitReachedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_SEAT_LIMIT_REACHED_COMMAND_TYPE,
    recordSeatLimitReachedCommandDataSchema,
    "Record that an organization reached a seat limit",
  );

  async handle(
    command: Command<RecordSeatLimitReachedCommandData>,
  ): Promise<SeatLimitReachedEvent[]> {
    const data = command.data;
    return [
      EventUtils.createEvent<SeatLimitReachedEvent>({
        aggregateType: SEAT_LIMIT_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: SEAT_LIMIT_REACHED_EVENT_TYPE,
        version: SEAT_LIMIT_REACHED_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:${data.limitType}:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordSeatLimitReachedCommandData): string {
    return payload.organizationId;
  }

  static getSpanAttributes(
    payload: RecordSeatLimitReachedCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.organization.id": payload.organizationId,
      "payload.seat_limit.limit_type": payload.limitType,
    };
  }
}
