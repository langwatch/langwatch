import { z } from "zod";
import { AVAILABLE_EVALUATORS } from "~/server/evaluations/evaluators.generated";

const evaluatorFieldSchema = z.object({
  identifier: z.string(),
  type: z.string(),
  optional: z.boolean().optional(),
});

export const apiResponseEvaluatorSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  slug: z.string().nullable(),
  type: z.string(),
  config: z.record(z.any()).nullable(),
  workflowId: z.string().nullable(),
  copiedFromEvaluatorId: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  fields: z.array(evaluatorFieldSchema),
  outputFields: z.array(evaluatorFieldSchema),
  workflowName: z.string().optional(),
  workflowIcon: z.string().optional(),
});

export type ApiResponseEvaluator = z.infer<typeof apiResponseEvaluatorSchema>;

const validEvaluatorTypes = new Set(Object.keys(AVAILABLE_EVALUATORS));

export const createEvaluatorInputSchema = z.object({
  name: z.string().min(1).max(255),
  config: z
    .record(z.unknown())
    .refine(
      (config) =>
        typeof config.evaluatorType === "string" &&
        config.evaluatorType.length > 0,
      {
        message:
          'config must include an "evaluatorType" field (e.g. "langevals/exact_match")',
      },
    )
    .refine(
      (config) => validEvaluatorTypes.has(config.evaluatorType as string),
      (config) => ({
        message: `Unknown evaluatorType "${String(config.evaluatorType)}". Use GET /api/evaluators to list valid evaluator configurations, or refer to the docs for available evaluator types.`,
      }),
    ),
});

export const updateEvaluatorInputSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  config: z
    .record(z.unknown())
    .optional(),
});
