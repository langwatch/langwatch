import { z } from "zod";

const evaluatorWireFieldSchema = z.object({
  identifier: z.string(),
  type: z.string(),
  optional: z.boolean().optional(),
});

export const evaluatorWireSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  slug: z.string().nullable(),
  type: z.string(),
  config: z.record(z.string(), z.unknown()).nullable(),
  workflowId: z.string().nullable(),
  copiedFromEvaluatorId: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  fields: z.array(evaluatorWireFieldSchema),
  outputFields: z.array(evaluatorWireFieldSchema),
  workflowName: z.string().optional(),
  workflowIcon: z.string().optional(),
  platformUrl: z.string().url(),
});

export const evaluatorIdParamsSchema = z.object({
  id: z.string().min(1).describe("The evaluator id."),
});

export const evaluatorIdOrSlugParamsSchema = z.object({
  idOrSlug: z.string().min(1).describe("The evaluator id or its project-unique slug."),
});

export const archivedEvaluatorResponseSchema = z.object({ success: z.boolean() });
