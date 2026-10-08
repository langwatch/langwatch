import {
  EVALUATOR_AGGREGATE_TYPE,
  EVALUATOR_DELETED_EVENT_TYPE,
  EVALUATOR_DELETED_EVENT_VERSION,
  evaluatorDeletedEventDataSchema,
} from "@langwatch/evaluator-contract";
import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventSchema, EventUtils } from "@langwatch/eventing";
import { z } from "zod";

export const RECORD_EVALUATOR_DELETED_COMMAND_TYPE = "lw.evaluator.record_deleted" as const;

export const recordEvaluatorDeletedCommandDataSchema = evaluatorDeletedEventDataSchema;
export type RecordEvaluatorDeletedCommandData = z.infer<
  typeof recordEvaluatorDeletedCommandDataSchema
>;

export const evaluatorDeletedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(EVALUATOR_DELETED_EVENT_TYPE),
  version: z.literal(EVALUATOR_DELETED_EVENT_VERSION),
  data: evaluatorDeletedEventDataSchema,
});
export type EvaluatorDeletedEvent = z.infer<typeof evaluatorDeletedEventSchema>;

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
