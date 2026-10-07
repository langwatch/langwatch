import {
  EVALUATOR_AGGREGATE_TYPE,
  EVALUATOR_DELETED_EVENT_TYPE,
  EVALUATOR_DELETED_EVENT_VERSION,
} from "@langwatch/evaluator-contract";
import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";

import {
  type EvaluatorDeletedEvent,
  RECORD_EVALUATOR_DELETED_COMMAND_TYPE,
  type RecordEvaluatorDeletedCommandData,
  recordEvaluatorDeletedCommandDataSchema,
} from "./evaluator-lifecycle.events.ts";

/**
 * Records that an evaluator was archived with its cascade. Each archive is its own fact,
 * keyed by its instant, so a redelivered command records nothing new.
 */
export class RecordEvaluatorDeletedCommand implements CommandHandler<
  Command<RecordEvaluatorDeletedCommandData>,
  EvaluatorDeletedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_EVALUATOR_DELETED_COMMAND_TYPE,
    recordEvaluatorDeletedCommandDataSchema,
    "Record that an evaluator was archived with its cascade",
  );

  handle(command: Command<RecordEvaluatorDeletedCommandData>): EvaluatorDeletedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<EvaluatorDeletedEvent>({
        aggregateType: EVALUATOR_AGGREGATE_TYPE,
        aggregateId: data.evaluatorId,
        tenantId: createTenantId(command.tenantId),
        type: EVALUATOR_DELETED_EVENT_TYPE,
        version: EVALUATOR_DELETED_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.projectId}:${data.evaluatorId}:deleted:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordEvaluatorDeletedCommandData): string {
    return payload.evaluatorId;
  }

  static getSpanAttributes(
    payload: RecordEvaluatorDeletedCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.project.id": payload.projectId,
      "payload.evaluator.id": payload.evaluatorId,
    };
  }
}
