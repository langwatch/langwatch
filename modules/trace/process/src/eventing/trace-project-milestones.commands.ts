import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";
import {
  FIRST_TRACE_RECORDED_EVENT_TYPE,
  TRACE_FIRST_SEEN_EVENT_TYPE,
  TRACE_RECEIVED_EVENT_TYPE,
  MONTH_TRACES_COUNTED_EVENT_TYPE,
} from "@langwatch/trace-contract";

import {
  type FirstTraceRecordedEvent,
  RECORD_FIRST_TRACE_COMMAND_TYPE,
  RECORD_TRACE_FIRST_SEEN_COMMAND_TYPE,
  RECORD_TRACE_RECEIVED_COMMAND_TYPE,
  RECORD_MONTH_TRACES_COUNTED_COMMAND_TYPE,
  type RecordFirstTraceCommandData,
  recordFirstTraceCommandDataSchema,
  type RecordTraceFirstSeenCommandData,
  recordTraceFirstSeenCommandDataSchema,
  type RecordTraceReceivedCommandData,
  recordTraceReceivedCommandDataSchema,
  type RecordMonthTracesCountedCommandData,
  recordMonthTracesCountedCommandDataSchema,
  TRACE_PROJECT_AGGREGATE_TYPE,
  TRACE_PROJECT_MILESTONES_EVENT_VERSION,
  type TraceFirstSeenEvent,
  type TraceReceivedEvent,
  type MonthTracesCountedEvent,
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

/** Records a trace's first sighting, keyed by tenant and trace id. */
export class RecordTraceFirstSeenCommand implements CommandHandler<
  Command<RecordTraceFirstSeenCommandData>,
  TraceFirstSeenEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_TRACE_FIRST_SEEN_COMMAND_TYPE,
    recordTraceFirstSeenCommandDataSchema,
    "Record that a project's trace was seen for the first time",
  );

  handle(command: Command<RecordTraceFirstSeenCommandData>): TraceFirstSeenEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<TraceFirstSeenEvent>({
        aggregateType: TRACE_PROJECT_AGGREGATE_TYPE,
        aggregateId: data.projectId,
        tenantId: createTenantId(command.tenantId),
        type: TRACE_FIRST_SEEN_EVENT_TYPE,
        version: TRACE_PROJECT_MILESTONES_EVENT_VERSION,
        data,
        occurredAt: data.firstSeenAt,
        idempotencyKey: `${data.tenantId}:${data.traceId}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordTraceFirstSeenCommandData): string {
    return payload.projectId;
  }
}

/** Records a project's month as counted by the upgrade; one event per project and month. */
export class RecordMonthTracesCountedCommand implements CommandHandler<
  Command<RecordMonthTracesCountedCommandData>,
  MonthTracesCountedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_MONTH_TRACES_COUNTED_COMMAND_TYPE,
    recordMonthTracesCountedCommandDataSchema,
    "Record how many traces a project first saw in a month before the upgrade's count moment",
  );

  handle(command: Command<RecordMonthTracesCountedCommandData>): MonthTracesCountedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<MonthTracesCountedEvent>({
        aggregateType: TRACE_PROJECT_AGGREGATE_TYPE,
        aggregateId: data.projectId,
        tenantId: createTenantId(command.tenantId),
        type: MONTH_TRACES_COUNTED_EVENT_TYPE,
        version: TRACE_PROJECT_MILESTONES_EVENT_VERSION,
        data,
        occurredAt: data.countedUntil,
        idempotencyKey: `${data.projectId}:${data.month}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordMonthTracesCountedCommandData): string {
    return payload.projectId;
  }
}
