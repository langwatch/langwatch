import {
  EVALUATION_LIFECYCLE_AGGREGATE_TYPE,
  EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
  EVALUATION_LIFECYCLE_EVENT_VERSION,
  EVALUATION_RAN_EVENT_TYPE,
} from "@langwatch/evaluation-contract";
import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";

import {
  RECORD_EVALUATION_LIFECYCLE_COMPLETED_COMMAND_TYPE,
  RECORD_EVALUATION_RAN_COMMAND_TYPE,
  type EvaluationLifecycleCompletedEvent,
  type EvaluationRanEvent,
  type RecordEvaluationLifecycleCompletedCommandData,
  type RecordEvaluationRanCommandData,
  recordEvaluationLifecycleCompletedCommandDataSchema,
  recordEvaluationRanCommandDataSchema,
} from "./evaluation-lifecycle.events.ts";

/** Records that a person ran an evaluation by hand; the same send twice is one event. */
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
        aggregateId: data.projectId,
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
    return payload.projectId;
  }
}

/** Records that an evaluation settled; one event per evaluation, however often it is sent. */
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
        aggregateId: data.projectId,
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
    return payload.projectId;
  }
}
