import type { Named } from "@langwatch/module";
import { z } from "zod";

import { AVAILABLE_EVALUATORS } from "./evaluators.ts";

const evaluatorWireFieldSchema = z.object({
  identifier: z.string(),
  type: z.string(),
  optional: z.boolean().optional(),
});

const evaluatorWireSchemaDefinition = z.object({
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
export interface EvaluatorWireSchema extends Named<typeof evaluatorWireSchemaDefinition> {}
export const evaluatorWireSchema: EvaluatorWireSchema = evaluatorWireSchemaDefinition;

const evaluatorIdParamsSchemaDefinition = z.object({
  id: z.string().min(1).describe("The evaluator id."),
});
export interface EvaluatorIdParamsSchema extends Named<typeof evaluatorIdParamsSchemaDefinition> {}
export const evaluatorIdParamsSchema: EvaluatorIdParamsSchema = evaluatorIdParamsSchemaDefinition;

const evaluatorIdOrSlugParamsSchemaDefinition = z.object({
  idOrSlug: z.string().min(1).describe("The evaluator id or its project-unique slug."),
});
export interface EvaluatorIdOrSlugParamsSchema extends Named<
  typeof evaluatorIdOrSlugParamsSchemaDefinition
> {}
export const evaluatorIdOrSlugParamsSchema: EvaluatorIdOrSlugParamsSchema =
  evaluatorIdOrSlugParamsSchemaDefinition;

const archivedEvaluatorResponseSchemaDefinition = z.object({ success: z.boolean() });
export interface ArchivedEvaluatorResponseSchema extends Named<
  typeof archivedEvaluatorResponseSchemaDefinition
> {}
export const archivedEvaluatorResponseSchema: ArchivedEvaluatorResponseSchema =
  archivedEvaluatorResponseSchemaDefinition;

/** An evaluator row as the `/api/evaluators` family reads it before it gains its `platformUrl`. */
const apiResponseEvaluatorSchemaDefinition = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  slug: z.string().nullable(),
  type: z.string(),
  config: z.record(z.string(), z.any()).nullable(),
  workflowId: z.string().nullable(),
  copiedFromEvaluatorId: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  fields: z.array(evaluatorWireFieldSchema),
  outputFields: z.array(evaluatorWireFieldSchema),
  workflowName: z.string().optional(),
  workflowIcon: z.string().optional(),
});
export interface ApiResponseEvaluatorSchema extends Named<
  typeof apiResponseEvaluatorSchemaDefinition
> {}
export const apiResponseEvaluatorSchema: ApiResponseEvaluatorSchema =
  apiResponseEvaluatorSchemaDefinition;

export type ApiResponseEvaluator = z.infer<typeof apiResponseEvaluatorSchema>;

const validEvaluatorTypes: readonly string[] = Object.keys(AVAILABLE_EVALUATORS);

const createEvaluatorInputSchemaDefinition = z.object({
  name: z.string().min(1).max(255),
  config: z.record(z.string(), z.unknown()).superRefine((config, ctx) => {
    const evaluatorType = config.evaluatorType;
    if (typeof evaluatorType !== "string" || evaluatorType.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'config must include an "evaluatorType" field (e.g. "langevals/exact_match")',
      });
      return;
    }
    if (!validEvaluatorTypes.includes(evaluatorType)) {
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
          expected: [...validEvaluatorTypes].toSorted(),
          received: evaluatorType,
        },
      });
    }
  }),
});
export interface CreateEvaluatorInputSchema extends Named<
  typeof createEvaluatorInputSchemaDefinition
> {}
export const createEvaluatorInputSchema: CreateEvaluatorInputSchema =
  createEvaluatorInputSchemaDefinition;

const updateEvaluatorInputSchemaDefinition = z.object({
  name: z.string().min(1).max(255).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export interface UpdateEvaluatorInputSchema extends Named<
  typeof updateEvaluatorInputSchemaDefinition
> {}
export const updateEvaluatorInputSchema: UpdateEvaluatorInputSchema =
  updateEvaluatorInputSchemaDefinition;
