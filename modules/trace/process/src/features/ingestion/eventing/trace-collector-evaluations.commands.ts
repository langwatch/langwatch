import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";
import { COLLECTOR_EVALUATION_RECEIVED_EVENT_TYPE } from "@langwatch/trace-contract";

import {
  type CollectorEvaluationReceivedEvent,
  RECORD_COLLECTOR_EVALUATION_COMMAND_TYPE,
  type RecordCollectorEvaluationCommandData,
  recordCollectorEvaluationCommandDataSchema,
  TRACE_COLLECTOR_EVALUATION_AGGREGATE_TYPE,
  TRACE_COLLECTOR_EVALUATIONS_EVENT_VERSION,
} from "./trace-collector-evaluations.events.ts";

/** Records one evaluation a collector body carried; one event per evaluation and request. */
export class RecordCollectorEvaluationCommand implements CommandHandler<
  Command<RecordCollectorEvaluationCommandData>,
  CollectorEvaluationReceivedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_COLLECTOR_EVALUATION_COMMAND_TYPE,
    recordCollectorEvaluationCommandDataSchema,
    "Record an evaluation a collector body carried, for evaluation to report",
  );

  handle(
    command: Command<RecordCollectorEvaluationCommandData>,
  ): CollectorEvaluationReceivedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<CollectorEvaluationReceivedEvent>({
        aggregateType: TRACE_COLLECTOR_EVALUATION_AGGREGATE_TYPE,
        aggregateId: data.traceId,
        tenantId: createTenantId(command.tenantId),
        type: COLLECTOR_EVALUATION_RECEIVED_EVENT_TYPE,
        version: TRACE_COLLECTOR_EVALUATIONS_EVENT_VERSION,
        data,
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.traceId}:${data.evaluationId}:collector_evaluation:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordCollectorEvaluationCommandData): string {
    return payload.traceId;
  }
}
