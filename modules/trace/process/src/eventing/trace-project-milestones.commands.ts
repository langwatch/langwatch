import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";
import {
  FIRST_TRACE_RECORDED_EVENT_TYPE,
  TRACE_RECEIVED_EVENT_TYPE,
} from "@langwatch/trace-contract";

import {
  type FirstTraceRecordedEvent,
  RECORD_FIRST_TRACE_COMMAND_TYPE,
  RECORD_TRACE_RECEIVED_COMMAND_TYPE,
  type RecordFirstTraceCommandData,
  recordFirstTraceCommandDataSchema,
  type RecordTraceReceivedCommandData,
  recordTraceReceivedCommandDataSchema,
  TRACE_PROJECT_AGGREGATE_TYPE,
  TRACE_PROJECT_MILESTONES_EVENT_VERSION,
  type TraceReceivedEvent,
} from "./trace-project-milestones.events.ts";

/** Records a project's first real trace; one event per project, however often it is sent. */
export class RecordFirstTraceCommand implements CommandHandler<
  Command<RecordFirstTraceCommandData>,
  FirstTraceRecordedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_FIRST_TRACE_COMMAND_TYPE,
    recordFirstTraceCommandDataSchema,
    "Record that a project sent its first real trace",
  );

  handle(command: Command<RecordFirstTraceCommandData>): FirstTraceRecordedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<FirstTraceRecordedEvent>({
        aggregateType: TRACE_PROJECT_AGGREGATE_TYPE,
        aggregateId: data.projectId,
        tenantId: createTenantId(command.tenantId),
        type: FIRST_TRACE_RECORDED_EVENT_TYPE,
        version: TRACE_PROJECT_MILESTONES_EVENT_VERSION,
        data,
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.projectId}:first_trace_recorded`,
      }),
    ];
  }

  static getAggregateId(payload: RecordFirstTraceCommandData): string {
    return payload.projectId;
  }
}

/** Records a later real trace; one event per project and trace instant. */
export class RecordTraceReceivedCommand implements CommandHandler<
  Command<RecordTraceReceivedCommandData>,
  TraceReceivedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_TRACE_RECEIVED_COMMAND_TYPE,
    recordTraceReceivedCommandDataSchema,
    "Record that a project which already sent its first trace received another",
  );

  handle(command: Command<RecordTraceReceivedCommandData>): TraceReceivedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<TraceReceivedEvent>({
        aggregateType: TRACE_PROJECT_AGGREGATE_TYPE,
        aggregateId: data.projectId,
        tenantId: createTenantId(command.tenantId),
        type: TRACE_RECEIVED_EVENT_TYPE,
        version: TRACE_PROJECT_MILESTONES_EVENT_VERSION,
        data,
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.projectId}:trace_received:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordTraceReceivedCommandData): string {
    return payload.projectId;
  }
}
