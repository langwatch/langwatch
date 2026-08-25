import { z } from "zod";

export const evaluationRunLookupSchema = z.object({
  tenantId: z.string(),
  evaluationId: z.string(),
  scheduledAt: z.date().optional(),
  scheduledAtSlackMs: z.number().int().positive().optional(),
});
export type EvaluationRunLookup = z.infer<typeof evaluationRunLookupSchema>;

export const evaluationRunsByTraceQuerySchema = z.object({
  tenantId: z.string(),
  traceId: z.string(),
});
export type EvaluationRunsByTraceQuery = z.infer<
  typeof evaluationRunsByTraceQuerySchema
>;

export const evaluationSummariesByTraceIdsQuerySchema = z.object({
  tenantId: z.string(),
  traceIds: z.array(z.string()),
  since: z.number().int(),
});
export type EvaluationSummariesByTraceIdsQuery = z.infer<
  typeof evaluationSummariesByTraceIdsQuerySchema
>;

export const traceEvaluationsQuerySchema = z.object({
  tenantId: z.string(),
  traceIds: z.array(z.string()),
});
export type TraceEvaluationsQuery = z.infer<typeof traceEvaluationsQuerySchema>;

export const evaluationInputsQuerySchema = z.object({
  tenantId: z.string(),
  evaluationId: z.string(),
});
export type EvaluationInputsQuery = z.infer<typeof evaluationInputsQuerySchema>;
