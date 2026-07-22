import { z } from "zod";
import { AVAILABLE_EVALUATORS } from "~/server/evaluations/evaluators";

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
  config: z.record(z.unknown()).superRefine((config, ctx) => {
    const evaluatorType = config.evaluatorType;
    if (typeof evaluatorType !== "string" || evaluatorType.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'config must include an "evaluatorType" field (e.g. "langevals/exact_match")',
      });
      return;
    }
    if (!validEvaluatorTypes.has(evaluatorType)) {
      // The accepted set rides as `params`, which the boundary validator
      // surfaces as the reason's `meta.expected`/`meta.received` — the same
      // channel enum failures use. The catalog is ~40 slugs, small enough to
      // carry whole; the message stays one sentence and never inlines it,
      // because prose is what gets truncated on its way to a model.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evaluatorType"],
        message: `Unknown evaluatorType "${evaluatorType}". Pick one of the types in this error's expected list and retry.`,
        params: {
          expected: [...validEvaluatorTypes].sort(),
          received: evaluatorType,
        },
      });
    }
  }),
});

export const updateEvaluatorInputSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  config: z
    .record(z.unknown())
    .optional(),
});
