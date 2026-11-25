import type { Named } from "@langwatch/module";
import { z } from "zod";

const evaluatorIdOrSlugInputSchemaDefinition = z
  .object({
    idOrSlug: z.string().min(1),
    projectId: z.string().min(1),
  })
  .strict();
export interface EvaluatorIdOrSlugInputSchema extends Named<
  typeof evaluatorIdOrSlugInputSchemaDefinition
> {}
export const evaluatorIdOrSlugInputSchema: EvaluatorIdOrSlugInputSchema =
  evaluatorIdOrSlugInputSchemaDefinition;
export type EvaluatorIdOrSlugInput = z.infer<typeof evaluatorIdOrSlugInputSchema>;

const evaluatorExecutionConfigSchemaDefinition = z
  .object({
    evaluatorType: z.string().optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
export interface EvaluatorExecutionConfigSchema extends Named<
  typeof evaluatorExecutionConfigSchemaDefinition
> {}
export const evaluatorExecutionConfigSchema: EvaluatorExecutionConfigSchema =
  evaluatorExecutionConfigSchemaDefinition;

const resolvedEvaluatorExecutionSchemaDefinition = z
  .object({
    evaluatorId: z.string().min(1),
    name: z.string().min(1),
    checkType: z.string().min(1),
    settings: z.record(z.string(), z.unknown()).optional(),
    requiredFields: z.array(z.string().min(1)).optional(),
  })
  .strict();
export interface ResolvedEvaluatorExecutionSchema extends Named<
  typeof resolvedEvaluatorExecutionSchemaDefinition
> {}
export const resolvedEvaluatorExecutionSchema: ResolvedEvaluatorExecutionSchema =
  resolvedEvaluatorExecutionSchemaDefinition;
export type ResolvedEvaluatorExecution = z.infer<typeof resolvedEvaluatorExecutionSchema>;

export function coerceEvaluatorScalar(value: unknown): unknown {
  if (value === null || value === void 0 || typeof value === "string") {
    return value;
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable value]";
  }
}
