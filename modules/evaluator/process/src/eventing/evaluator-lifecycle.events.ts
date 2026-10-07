import {
  EVALUATOR_DELETED_EVENT_TYPE,
  EVALUATOR_DELETED_EVENT_VERSION,
  evaluatorDeletedEventDataSchema,
} from "@langwatch/evaluator-contract";
import { EventSchema } from "@langwatch/eventing";
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
