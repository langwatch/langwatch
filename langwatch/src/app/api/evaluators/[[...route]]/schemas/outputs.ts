import { z } from "zod";
import { flexibleDateSchema } from "~/app/api/shared/schemas";

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
  createdAt: flexibleDateSchema,
  updatedAt: flexibleDateSchema,
  fields: z.array(evaluatorFieldSchema),
  outputFields: z.array(evaluatorFieldSchema),
  workflowName: z.string().optional(),
  workflowIcon: z.string().optional(),
});

export type ApiResponseEvaluator = z.infer<typeof apiResponseEvaluatorSchema>;
