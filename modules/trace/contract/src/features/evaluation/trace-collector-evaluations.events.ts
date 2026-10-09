import { z } from "zod";

/**
 * An evaluation a collector body carried, recorded by trace and reported by evaluation from its
 * own side (T1 D1, 2026-10-08; R38 "evaluations received", §9).
 */
export const COLLECTOR_EVALUATION_RECEIVED_EVENT_TYPE =
  "lw.trace.collector_evaluation_received" as const;

/** One SDK evaluation as the collector door built it, its evaluator id already derived. */
export const collectorEvaluationReceivedEventDataSchema = z.object({
  tenantId: z.string().min(1),
  evaluationId: z.string().min(1),
  evaluatorId: z.string().min(1),
  evaluatorType: z.string(),
  evaluatorName: z.string().optional(),
  traceId: z.string().min(1),
  isGuardrail: z.boolean().optional(),
  status: z.enum(["processed", "error", "skipped"]),
  score: z.number().nullable(),
  passed: z.boolean().nullable(),
  label: z.string().nullable(),
  details: z.string().nullable(),
  error: z.string().nullable(),
  occurredAt: z.number().int().nonnegative(),
});
export type CollectorEvaluationReceivedEventData = z.infer<
  typeof collectorEvaluationReceivedEventDataSchema
>;
