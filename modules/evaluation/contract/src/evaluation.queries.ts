import type { Named } from "@langwatch/module";
import { z } from "zod";

const evaluationRunLookupSchemaDefinition = z.object({
  tenantId: z.string(),
  evaluationId: z.string(),
  scheduledAt: z.date().optional(),
  scheduledAtSlackMs: z.number().int().positive().optional(),
});
export interface EvaluationRunLookupSchema extends Named<
  typeof evaluationRunLookupSchemaDefinition
> {}
export const evaluationRunLookupSchema: EvaluationRunLookupSchema =
  evaluationRunLookupSchemaDefinition;
export type EvaluationRunLookup = z.infer<typeof evaluationRunLookupSchema>;

const evaluationRunsByTraceQuerySchemaDefinition = z.object({
  tenantId: z.string(),
  traceId: z.string(),
});
export interface EvaluationRunsByTraceQuerySchema extends Named<
  typeof evaluationRunsByTraceQuerySchemaDefinition
> {}
export const evaluationRunsByTraceQuerySchema: EvaluationRunsByTraceQuerySchema =
  evaluationRunsByTraceQuerySchemaDefinition;
export type EvaluationRunsByTraceQuery = z.infer<typeof evaluationRunsByTraceQuerySchema>;

const evaluationSummariesByTraceIdsQuerySchemaDefinition = z.object({
  tenantId: z.string(),
  traceIds: z.array(z.string()),
  since: z.number().int(),
});
export interface EvaluationSummariesByTraceIdsQuerySchema extends Named<
  typeof evaluationSummariesByTraceIdsQuerySchemaDefinition
> {}
export const evaluationSummariesByTraceIdsQuerySchema: EvaluationSummariesByTraceIdsQuerySchema =
  evaluationSummariesByTraceIdsQuerySchemaDefinition;
export type EvaluationSummariesByTraceIdsQuery = z.infer<
  typeof evaluationSummariesByTraceIdsQuerySchema
>;

const traceEvaluationsQuerySchemaDefinition = z.object({
  tenantId: z.string(),
  traceIds: z.array(z.string()),
});
export interface TraceEvaluationsQuerySchema extends Named<
  typeof traceEvaluationsQuerySchemaDefinition
> {}
export const traceEvaluationsQuerySchema: TraceEvaluationsQuerySchema =
  traceEvaluationsQuerySchemaDefinition;
export type TraceEvaluationsQuery = z.infer<typeof traceEvaluationsQuerySchema>;

const evaluationInputsQuerySchemaDefinition = z.object({
  projectId: z.string(),
  evaluationId: z.string(),
  /** On an aggregate, the member that holds the evaluation; the proof narrows to it. */
  tenantId: z.string().min(1).optional(),
});
export interface EvaluationInputsQuerySchema extends Named<
  typeof evaluationInputsQuerySchemaDefinition
> {}
export const evaluationInputsQuerySchema: EvaluationInputsQuerySchema =
  evaluationInputsQuerySchemaDefinition;
export type EvaluationInputsQuery = z.infer<typeof evaluationInputsQuerySchema>;

/** Where a page of evaluation outcomes resumes: after this (occurredAt, evaluationId). */
const evaluationOutcomeCursorSchemaDefinition = z.object({
  occurredAt: z.number().int(),
  evaluationId: z.string(),
});
export interface EvaluationOutcomeCursorSchema extends Named<
  typeof evaluationOutcomeCursorSchemaDefinition
> {}
export const evaluationOutcomeCursorSchema: EvaluationOutcomeCursorSchema =
  evaluationOutcomeCursorSchemaDefinition;
export type EvaluationOutcomeCursor = z.infer<typeof evaluationOutcomeCursorSchema>;

/** One project's finished evaluations on a trace since `sinceMs`, in (occurredAt, id) order. */
const evaluationOutcomesQuerySchemaDefinition = z.object({
  tenantId: z.string(),
  sinceMs: z.number().int(),
  after: evaluationOutcomeCursorSchema.nullable(),
  limit: z.number().int().positive().max(1000),
});
export interface EvaluationOutcomesQuerySchema extends Named<
  typeof evaluationOutcomesQuerySchemaDefinition
> {}
export const evaluationOutcomesQuerySchema: EvaluationOutcomesQuerySchema =
  evaluationOutcomesQuerySchemaDefinition;
export type EvaluationOutcomesQuery = z.infer<typeof evaluationOutcomesQuerySchema>;
