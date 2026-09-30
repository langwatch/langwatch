import { z } from "zod";

/** Evaluation's lifecycle facts, which peers react to from their own side (§9). */
export const EVALUATION_LIFECYCLE_PIPELINE_NAME = "evaluation_lifecycle" as const;
export const EVALUATION_LIFECYCLE_AGGREGATE_TYPE = "evaluation_lifecycle" as const;
export const EVALUATION_RAN_EVENT_TYPE = "lw.evaluation.ran" as const;
export const EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE =
  "lw.evaluation.lifecycle_completed" as const;
export const EVALUATION_LIFECYCLE_EVENT_VERSION = "2026-09-30" as const;

/** A person ran an evaluation on a trace by hand. */
export const evaluationRanEventDataSchema = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  userId: z.string().min(1),
  projectId: z.string().min(1),
});
export type EvaluationRanEventData = z.infer<typeof evaluationRanEventDataSchema>;

/** An evaluation settled (completed or reported), with the organization's count including it. */
export const evaluationLifecycleCompletedEventDataSchema = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  /** The organization's admin. */
  userId: z.string().min(1),
  projectId: z.string().min(1),
  evaluationId: z.string().min(1),
  evaluatorType: z.string().nullish(),
  score: z.number().nullish(),
  passed: z.boolean().nullish(),
  organizationEvaluationCount: z.number().int().positive(),
});
export type EvaluationLifecycleCompletedEventData = z.infer<
  typeof evaluationLifecycleCompletedEventDataSchema
>;
