import { z } from "zod";

export const evaluatorIdOrSlugInputSchema = z
  .object({
    idOrSlug: z.string().min(1),
    projectId: z.string().min(1),
  })
  .strict();
export type EvaluatorIdOrSlugInput = z.infer<typeof evaluatorIdOrSlugInputSchema>;

export const evaluatorExecutionConfigSchema = z
  .object({
    evaluatorType: z.string().optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const resolvedEvaluatorExecutionSchema = z
  .object({
    evaluatorId: z.string().min(1),
    name: z.string().min(1),
    checkType: z.string().min(1),
    settings: z.record(z.string(), z.unknown()).optional(),
    requiredFields: z.array(z.string().min(1)).optional(),
  })
  .strict();
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
    return String(value);
  }
}
