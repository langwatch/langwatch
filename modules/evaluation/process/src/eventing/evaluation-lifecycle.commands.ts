import {
  EVALUATION_LIFECYCLE_AGGREGATE_TYPE,
  EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
  EVALUATION_LIFECYCLE_EVENT_VERSION,
  EVALUATION_MONITOR_ERROR_RATE_EXCEEDED_EVENT_TYPE,
  EVALUATION_RAN_EVENT_TYPE,
} from "@langwatch/evaluation-contract";
import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";

import {
  RECORD_EVALUATION_LIFECYCLE_COMPLETED_COMMAND_TYPE,
  RECORD_EVALUATION_RAN_COMMAND_TYPE,
  RECORD_MONITOR_ERROR_RATE_EXCEEDED_COMMAND_TYPE,
  type EvaluationLifecycleCompletedEvent,
  type EvaluationMonitorErrorRateExceededEvent,
  type EvaluationRanEvent,
  type RecordEvaluationLifecycleCompletedCommandData,
  type RecordEvaluationRanCommandData,
  type RecordMonitorErrorRateExceededCommandData,
  recordEvaluationLifecycleCompletedCommandDataSchema,
  recordEvaluationRanCommandDataSchema,
  recordMonitorErrorRateExceededCommandDataSchema,
} from "./evaluation-lifecycle.events.ts";

/**
 * Records that a person ran an evaluation by hand; the same send twice is one event. Keyed by the
 * run (its person and instant), never the project, so one project's runs never queue in a line.
 */
export class RecordEvaluationRanCommand implements CommandHandler<
  Command<RecordEvaluationRanCommandData>,
  EvaluationRanEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_EVALUATION_RAN_COMMAND_TYPE,
    recordEvaluationRanCommandDataSchema,
    "Record that a person ran an evaluation",
  );

  handle(command: Command<RecordEvaluationRanCommandData>): EvaluationRanEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<EvaluationRanEvent>({
        aggregateType: EVALUATION_LIFECYCLE_AGGREGATE_TYPE,
        aggregateId: RecordEvaluationRanCommand.getAggregateId(data),
        tenantId: createTenantId(command.tenantId),
        type: EVALUATION_RAN_EVENT_TYPE,
        version: EVALUATION_LIFECYCLE_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.tenantId}:${data.userId}:ran:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordEvaluationRanCommandData): string {
    return `${payload.userId}:${payload.occurredAt}`;
  }
}

/**
 * Records that an evaluation settled; one event per evaluation, however often it is sent. Keyed
 * by the evaluation, never its project: a project key queued every settled evaluation behind the
 * one before it, so one busy project held its whole backlog in a single group.
 */
export class RecordEvaluationLifecycleCompletedCommand implements CommandHandler<
  Command<RecordEvaluationLifecycleCompletedCommandData>,
  EvaluationLifecycleCompletedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_EVALUATION_LIFECYCLE_COMPLETED_COMMAND_TYPE,
    recordEvaluationLifecycleCompletedCommandDataSchema,
    "Record that an evaluation settled",
  );

  handle(
    command: Command<RecordEvaluationLifecycleCompletedCommandData>,
  ): EvaluationLifecycleCompletedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<EvaluationLifecycleCompletedEvent>({
        aggregateType: EVALUATION_LIFECYCLE_AGGREGATE_TYPE,
        aggregateId: RecordEvaluationLifecycleCompletedCommand.getAggregateId(data),
        tenantId: createTenantId(command.tenantId),
        type: EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
        version: EVALUATION_LIFECYCLE_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.tenantId}:${data.evaluationId}:lifecycle_completed`,
      }),
    ];
  }

  static getAggregateId(payload: RecordEvaluationLifecycleCompletedCommandData): string {
    return payload.evaluationId;
  }
}

/**
 * Records that most of a monitor's recent runs errored; one event per monitor revision, however
 * often it is sent. Keyed by the monitor and its revision, so one project's monitors never queue
 * behind each other.
 */
export class RecordMonitorErrorRateExceededCommand implements CommandHandler<
  Command<RecordMonitorErrorRateExceededCommandData>,
  EvaluationMonitorErrorRateExceededEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_MONITOR_ERROR_RATE_EXCEEDED_COMMAND_TYPE,
    recordMonitorErrorRateExceededCommandDataSchema,
    "Record that most of a monitor's recent runs errored",
  );

  handle(
    command: Command<RecordMonitorErrorRateExceededCommandData>,
  ): EvaluationMonitorErrorRateExceededEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<EvaluationMonitorErrorRateExceededEvent>({
        aggregateType: EVALUATION_LIFECYCLE_AGGREGATE_TYPE,
        aggregateId: RecordMonitorErrorRateExceededCommand.getAggregateId(data),
        tenantId: createTenantId(command.tenantId),
        type: EVALUATION_MONITOR_ERROR_RATE_EXCEEDED_EVENT_TYPE,
        version: EVALUATION_LIFECYCLE_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.tenantId}:${RecordMonitorErrorRateExceededCommand.getAggregateId(data)}:error_rate_exceeded`,
      }),
    ];
  }

  static getAggregateId(payload: RecordMonitorErrorRateExceededCommandData): string {
    return `monitor:${payload.monitorId}:${payload.monitorRevision}`;
  }
}
