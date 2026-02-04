import { z } from "zod";

/**
 * Base evaluation data shared across commands.
 */
const baseEvaluationSchema = z.object({
  tenantId: z.string(),
  evaluationId: z.string(),
  evaluatorId: z.string(),
  evaluatorType: z.string(),
  evaluatorName: z.string().optional(),
  traceId: z.string().optional(),
  isGuardrail: z.boolean().optional(),
});

/**
 * Command data for scheduling an evaluation.
 * Emitted when an evaluation job is added to the queue.
 */
export const scheduleEvaluationCommandDataSchema = baseEvaluationSchema;

export type ScheduleEvaluationCommandData = z.infer<
  typeof scheduleEvaluationCommandDataSchema
>;

/**
 * Command data for starting an evaluation.
 * Emitted when evaluation execution begins.
 */
export const startEvaluationCommandDataSchema = baseEvaluationSchema;

export type StartEvaluationCommandData = z.infer<
  typeof startEvaluationCommandDataSchema
>;

/**
 * Command data for completing an evaluation.
 * Emitted when evaluation execution finishes.
 */
export const completeEvaluationCommandDataSchema = z.object({
  tenantId: z.string(),
  evaluationId: z.string(),
  status: z.enum(["processed", "error", "skipped"]),
  score: z.number().optional(),
  passed: z.boolean().optional(),
  label: z.string().nullable().optional(),
  details: z.string().optional(),
  error: z.string().optional(),
});

export type CompleteEvaluationCommandData = z.infer<
  typeof completeEvaluationCommandDataSchema
>;
