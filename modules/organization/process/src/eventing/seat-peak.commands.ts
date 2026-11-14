import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";

import {
  RECORD_SEAT_CHANGED_COMMAND_TYPE,
  RECORD_SEAT_SNAPSHOT_COMMAND_TYPE,
  type RecordSeatChangedCommandData,
  recordSeatChangedCommandDataSchema,
  type RecordSeatSnapshotCommandData,
  recordSeatSnapshotCommandDataSchema,
  SEAT_CHANGED_EVENT_TYPE,
  SEAT_CHANGED_EVENT_VERSION,
  SEAT_PEAK_AGGREGATE_TYPE,
  SEAT_SNAPSHOT_TAKEN_EVENT_TYPE,
  SEAT_SNAPSHOT_TAKEN_EVENT_VERSION,
  type SeatChangedEvent,
  type SeatSnapshotTakenEvent,
} from "./seat-peak.events.ts";

/** Records one seat change. Its id was minted with the write, so a redelivery adds nothing. */
export class RecordSeatChangedCommand implements CommandHandler<
  Command<RecordSeatChangedCommandData>,
  SeatChangedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_SEAT_CHANGED_COMMAND_TYPE,
    recordSeatChangedCommandDataSchema,
    "Record that a holder's seat changed",
  );

  async handle(command: Command<RecordSeatChangedCommandData>): Promise<SeatChangedEvent[]> {
    const data = command.data;
    return [
      EventUtils.createEvent<SeatChangedEvent>({
        aggregateType: SEAT_PEAK_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: SEAT_CHANGED_EVENT_TYPE,
        version: SEAT_CHANGED_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: data.changeId,
      }),
    ];
  }

  static getAggregateId(payload: RecordSeatChangedCommandData): string {
    return payload.organizationId;
  }

  static getSpanAttributes(
    payload: RecordSeatChangedCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.organization.id": payload.organizationId,
      "payload.seat.from": payload.from,
      "payload.seat.to": payload.to,
      "payload.seat.cause": payload.cause,
    };
  }
}

/** Records every holder's seat as it stands: the count the fold opens from (ADR-002 §5). */
export class RecordSeatSnapshotCommand implements CommandHandler<
  Command<RecordSeatSnapshotCommandData>,
  SeatSnapshotTakenEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_SEAT_SNAPSHOT_COMMAND_TYPE,
    recordSeatSnapshotCommandDataSchema,
    "Record every holder's seat as it stands",
  );

  async handle(command: Command<RecordSeatSnapshotCommandData>): Promise<SeatSnapshotTakenEvent[]> {
    const data = command.data;
    return [
      EventUtils.createEvent<SeatSnapshotTakenEvent>({
        aggregateType: SEAT_PEAK_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: SEAT_SNAPSHOT_TAKEN_EVENT_TYPE,
        version: SEAT_SNAPSHOT_TAKEN_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordSeatSnapshotCommandData): string {
    return payload.organizationId;
  }

  static getSpanAttributes(
    payload: RecordSeatSnapshotCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.organization.id": payload.organizationId,
      "payload.seat.holders": payload.holders.length,
    };
  }
}
