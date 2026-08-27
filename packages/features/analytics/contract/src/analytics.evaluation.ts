import { z } from "zod";

const finiteNumberSchema = z.number().finite();
const nullableStringSchema = z.string().nullable();
const nullableFiniteNumberSchema = finiteNumberSchema.nullable();

/** Portable row written to the evaluation_analytics slim table. */
export const analyticsEvaluationRowSchema = z.object({
  tenantId: z.string().min(1),
  evaluationId: z.string().min(1),
  version: z.string().min(1),
  occurredAtMs: finiteNumberSchema,
  createdAtMs: finiteNumberSchema,
  updatedAtMs: finiteNumberSchema,
  evaluatorType: z.string(),
  evaluatorName: nullableStringSchema,
  status: z.string(),
  isGuardrail: z.boolean(),
  passed: z.boolean().nullable(),
  score: nullableFiniteNumberSchema,
  label: nullableStringSchema,
  model: nullableStringSchema,
  traceId: nullableStringSchema,
  userId: nullableStringSchema,
  conversationId: nullableStringSchema,
  customerId: nullableStringSchema,
  origin: nullableStringSchema,
  durationMs: finiteNumberSchema,
  totalCost: nullableFiniteNumberSchema,
  nonBilledCost: nullableFiniteNumberSchema,
  attributes: z.record(z.string(), z.string()),
  startedAtMs: nullableFiniteNumberSchema,
  completedAtMs: nullableFiniteNumberSchema,
});

export type AnalyticsEvaluationRow = z.infer<typeof analyticsEvaluationRowSchema>;

/** Portable row appended to the evaluation_analytics_rollup table. */
export const analyticsEvaluationRollupRowSchema = z.object({
  tenantId: z.string().min(1),
  bucketStart: z.date(),
  evaluatorType: z.string(),
  status: z.string(),
  evalCount: finiteNumberSchema,
  passCount: finiteNumberSchema,
  failCount: finiteNumberSchema,
  errorCount: finiteNumberSchema,
  skippedCount: finiteNumberSchema,
  scoreSum: finiteNumberSchema,
  scoreCount: finiteNumberSchema,
  durationSum: finiteNumberSchema,
  costSum: finiteNumberSchema,
  nonBilledCostSum: finiteNumberSchema,
});

export type AnalyticsEvaluationRollupRow = z.infer<typeof analyticsEvaluationRollupRowSchema>;

export const analyticsEvaluationUpsertInputSchema = z.object({
  row: analyticsEvaluationRowSchema,
  retentionDays: z.number().int().positive().optional(),
  appliedEventIds: z.array(z.string()).optional(),
});

export type AnalyticsEvaluationUpsertInput = z.infer<typeof analyticsEvaluationUpsertInputSchema>;

export const analyticsEvaluationUpsertBatchInputSchema = z.array(
  analyticsEvaluationUpsertInputSchema,
);

export const analyticsEvaluationReadInputSchema = z.object({
  tenantId: z.string().min(1),
  evaluationId: z.string().min(1),
  window: z
    .object({
      fromMs: finiteNumberSchema,
      toMs: finiteNumberSchema,
    })
    .optional(),
});

export type AnalyticsEvaluationReadInput = z.infer<typeof analyticsEvaluationReadInputSchema>;

export const analyticsEvaluationRollupAppendInputSchema = z.object({
  row: analyticsEvaluationRollupRowSchema,
  retentionDays: z.number().int().positive().optional(),
});

export type AnalyticsEvaluationRollupAppendInput = z.infer<
  typeof analyticsEvaluationRollupAppendInputSchema
>;

export const analyticsEvaluationRollupAppendBatchInputSchema = z.object({
  rows: z.array(analyticsEvaluationRollupRowSchema),
  retentionDays: z.number().int().positive().optional(),
});

export type AnalyticsEvaluationRollupAppendBatchInput = z.infer<
  typeof analyticsEvaluationRollupAppendBatchInputSchema
>;
