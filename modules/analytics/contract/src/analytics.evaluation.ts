import type { Named } from "@langwatch/module";
import { z } from "zod";

const finiteNumberSchema = z.number().finite();
const nullableStringSchema = z.string().nullable();
const nullableFiniteNumberSchema = finiteNumberSchema.nullable();
// 0 is the indefinite sentinel (INDEFINITE_RETENTION_DAYS): the row is kept, never aged out.
const retentionDaysSchema = z.number().int().nonnegative().optional();

/** Portable row written to the evaluation_analytics slim table. */
const analyticsEvaluationRowSchemaDefinition = z.object({
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
export interface AnalyticsEvaluationRowSchema extends Named<
  typeof analyticsEvaluationRowSchemaDefinition
> {}
export const analyticsEvaluationRowSchema: AnalyticsEvaluationRowSchema =
  analyticsEvaluationRowSchemaDefinition;

export type AnalyticsEvaluationRow = z.infer<typeof analyticsEvaluationRowSchema>;

/** Portable row appended to the evaluation_analytics_rollup table. */
const analyticsEvaluationRollupRowSchemaDefinition = z.object({
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
export interface AnalyticsEvaluationRollupRowSchema extends Named<
  typeof analyticsEvaluationRollupRowSchemaDefinition
> {}
export const analyticsEvaluationRollupRowSchema: AnalyticsEvaluationRollupRowSchema =
  analyticsEvaluationRollupRowSchemaDefinition;

export type AnalyticsEvaluationRollupRow = z.infer<typeof analyticsEvaluationRollupRowSchema>;

const analyticsEvaluationUpsertInputSchemaDefinition = z.object({
  row: analyticsEvaluationRowSchema,
  retentionDays: retentionDaysSchema,
  appliedEventIds: z.array(z.string()).optional(),
});
export interface AnalyticsEvaluationUpsertInputSchema extends Named<
  typeof analyticsEvaluationUpsertInputSchemaDefinition
> {}
export const analyticsEvaluationUpsertInputSchema: AnalyticsEvaluationUpsertInputSchema =
  analyticsEvaluationUpsertInputSchemaDefinition;

export type AnalyticsEvaluationUpsertInput = z.infer<typeof analyticsEvaluationUpsertInputSchema>;

const analyticsEvaluationUpsertBatchInputSchemaDefinition = z.array(
  analyticsEvaluationUpsertInputSchema,
);
export interface AnalyticsEvaluationUpsertBatchInputSchema extends Named<
  typeof analyticsEvaluationUpsertBatchInputSchemaDefinition
> {}
export const analyticsEvaluationUpsertBatchInputSchema: AnalyticsEvaluationUpsertBatchInputSchema =
  analyticsEvaluationUpsertBatchInputSchemaDefinition;

const analyticsEvaluationReadInputSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  evaluationId: z.string().min(1),
  window: z
    .object({
      fromMs: finiteNumberSchema,
      toMs: finiteNumberSchema,
    })
    .optional(),
});
export interface AnalyticsEvaluationReadInputSchema extends Named<
  typeof analyticsEvaluationReadInputSchemaDefinition
> {}
export const analyticsEvaluationReadInputSchema: AnalyticsEvaluationReadInputSchema =
  analyticsEvaluationReadInputSchemaDefinition;

export type AnalyticsEvaluationReadInput = z.infer<typeof analyticsEvaluationReadInputSchema>;

const analyticsEvaluationRollupAppendInputSchemaDefinition = z.object({
  row: analyticsEvaluationRollupRowSchema,
  retentionDays: retentionDaysSchema,
});
export interface AnalyticsEvaluationRollupAppendInputSchema extends Named<
  typeof analyticsEvaluationRollupAppendInputSchemaDefinition
> {}
export const analyticsEvaluationRollupAppendInputSchema: AnalyticsEvaluationRollupAppendInputSchema =
  analyticsEvaluationRollupAppendInputSchemaDefinition;

export type AnalyticsEvaluationRollupAppendInput = z.infer<
  typeof analyticsEvaluationRollupAppendInputSchema
>;

const analyticsEvaluationRollupAppendBatchInputSchemaDefinition = z.object({
  rows: z.array(analyticsEvaluationRollupRowSchema),
  retentionDays: retentionDaysSchema,
});
export interface AnalyticsEvaluationRollupAppendBatchInputSchema extends Named<
  typeof analyticsEvaluationRollupAppendBatchInputSchemaDefinition
> {}
export const analyticsEvaluationRollupAppendBatchInputSchema: AnalyticsEvaluationRollupAppendBatchInputSchema =
  analyticsEvaluationRollupAppendBatchInputSchemaDefinition;

export type AnalyticsEvaluationRollupAppendBatchInput = z.infer<
  typeof analyticsEvaluationRollupAppendBatchInputSchema
>;

export interface AnalyticsEvaluationReadMetrics {
  record(input: {
    table: "evaluation_analytics";
    outcome: "hit" | "windowed_empty" | "unwindowed" | "error";
  }): void;
}
