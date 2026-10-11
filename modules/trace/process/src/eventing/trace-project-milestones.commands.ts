import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";
import {
  FIRST_TRACE_RECORDED_EVENT_TYPE,
  TRACE_FIRST_SEEN_EVENT_TYPE,
  TRACE_RECEIVED_EVENT_TYPE,
  TRACES_COUNTED_BEFORE_CUT_EVENT_TYPE,
} from "@langwatch/trace-contract";

import { usageMonthOf } from "../rules/trace-first-seen.rules.ts";
import {
  type FirstTraceRecordedEvent,
  RECORD_FIRST_TRACE_COMMAND_TYPE,
  RECORD_TRACE_FIRST_SEEN_COMMAND_TYPE,
  RECORD_TRACE_RECEIVED_COMMAND_TYPE,
  RECORD_TRACES_COUNTED_BEFORE_CUT_COMMAND_TYPE,
  type RecordFirstTraceCommandData,
  recordFirstTraceCommandDataSchema,
  type RecordTraceFirstSeenCommandData,
  recordTraceFirstSeenCommandDataSchema,
  type RecordTraceReceivedCommandData,
  recordTraceReceivedCommandDataSchema,
  type RecordTracesCountedBeforeCutCommandData,
  recordTracesCountedBeforeCutCommandDataSchema,
  TRACE_PROJECT_AGGREGATE_TYPE,
  TRACE_PROJECT_MILESTONES_EVENT_VERSION,
  type TraceFirstSeenEvent,
  type TraceReceivedEvent,
  type TracesCountedBeforeCutEvent,
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

/** Records a trace's first sighting; keyed by trace and month, so a re-sent one is stored once. */
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
    const month = usageMonthOf(data.firstSeenAt);
    return [
      EventUtils.createEvent<TraceFirstSeenEvent>({
        aggregateType: TRACE_PROJECT_AGGREGATE_TYPE,
        aggregateId: data.projectId,
        tenantId: createTenantId(command.tenantId),
        type: TRACE_FIRST_SEEN_EVENT_TYPE,
        version: TRACE_PROJECT_MILESTONES_EVENT_VERSION,
        data,
        occurredAt: data.firstSeenAt,
        idempotencyKey: `${data.projectId}:trace_first_seen:${data.traceId}:${month}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordTraceFirstSeenCommandData): string {
    return payload.projectId;
  }
}

/** Records a project's month counted up to the upgrade's cut; one fact per project and month. */
export class RecordTracesCountedBeforeCutCommand implements CommandHandler<
  Command<RecordTracesCountedBeforeCutCommandData>,
  TracesCountedBeforeCutEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_TRACES_COUNTED_BEFORE_CUT_COMMAND_TYPE,
    recordTracesCountedBeforeCutCommandDataSchema,
    "Record how many traces a project first saw in a month before the count's cut",
  );

  handle(command: Command<RecordTracesCountedBeforeCutCommandData>): TracesCountedBeforeCutEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<TracesCountedBeforeCutEvent>({
        aggregateType: TRACE_PROJECT_AGGREGATE_TYPE,
        aggregateId: data.projectId,
        tenantId: createTenantId(command.tenantId),
        type: TRACES_COUNTED_BEFORE_CUT_EVENT_TYPE,
        version: TRACE_PROJECT_MILESTONES_EVENT_VERSION,
        data,
        occurredAt: data.cutAt,
        idempotencyKey: `${data.projectId}:traces_counted_before_cut:${data.month}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordTracesCountedBeforeCutCommandData): string {
    return payload.projectId;
  }
}
