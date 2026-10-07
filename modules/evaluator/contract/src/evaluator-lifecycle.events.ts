import { z } from "zod";

/** Evaluator's lifecycle facts, which peers react to from their own side (§9). */
export const EVALUATOR_LIFECYCLE_PIPELINE_NAME = "evaluator_lifecycle" as const;
export const EVALUATOR_AGGREGATE_TYPE = "evaluator" as const;
export const EVALUATOR_DELETED_EVENT_TYPE = "lw.evaluator.deleted" as const;
export const EVALUATOR_DELETED_EVENT_VERSION = "2026-10-07" as const;

/** Ids only: a peer reads anything else through `EvaluatorApi`, never the event. */
export const evaluatorDeletedEventDataSchema = z.object({
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  evaluatorId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
});
export type EvaluatorDeletedEventData = z.infer<typeof evaluatorDeletedEventDataSchema>;
