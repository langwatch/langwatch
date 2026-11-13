import type { Named } from "@langwatch/module";
import { z } from "zod";

import { codeEvaluatorCreateConfigSchema } from "./code-evaluator.ts";
import {
  evaluatorLabelSchema,
  evaluatorVersionSchema,
  evaluatorVersionSelectorSchema,
} from "./evaluator-version.ts";
import { evaluatorPersonViewSchema, evaluatorTypeSchema } from "./evaluator.ts";
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
  version: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe(
      "The version this response shows: the latest, unless a label or a version was asked for.",
    ),
  labels: z
    .array(z.object({ label: z.string(), version: z.number().int().positive() }))
    .describe(
      "The deploy labels the evaluator carries, such as production, and the version each points at.",
    ),
  createdBy: evaluatorPersonViewSchema
    .nullable()
    .describe(
      "The user who created the evaluator. Null when an API key created it, or it predates creators being recorded.",
    ),
  updatedBy: evaluatorPersonViewSchema
    .nullable()
    .describe("The user who changed the evaluator last. Null when an API key changed it."),
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
  version: z.number().int().positive().nullable().default(null),
  labels: z
    .array(z.object({ label: z.string(), version: z.number().int().positive() }))
    .default([]),
  createdBy: evaluatorPersonViewSchema.nullable().default(null),
  updatedBy: evaluatorPersonViewSchema.nullable().default(null),
});
export interface ApiResponseEvaluatorSchema extends Named<
  typeof apiResponseEvaluatorSchemaDefinition
> {}
export const apiResponseEvaluatorSchema: ApiResponseEvaluatorSchema =
  apiResponseEvaluatorSchemaDefinition;

export type ApiResponseEvaluator = z.infer<typeof apiResponseEvaluatorSchema>;

const validEvaluatorTypes: readonly string[] = Object.keys(AVAILABLE_EVALUATORS);

/** A built-in evaluator names its catalogue type on `config.evaluatorType`. */
function refineBuiltInConfig(config: Record<string, unknown>, ctx: z.RefinementCtx): void {
  const evaluatorType = config.evaluatorType;
  if (typeof evaluatorType !== "string" || evaluatorType.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["config"],
      message:
        'config must include an "evaluatorType" field (e.g. "langevals/exact_match"), or set "type": "code" for a custom code evaluator',
    });
    return;
  }
  if (!validEvaluatorTypes.includes(evaluatorType)) {
    // The accepted set rides as `params`, which the boundary validator
    // surfaces as `meta.expected`/`meta.received`. The message never inlines
    // it, because prose is what gets truncated on its way to a model.
    ctx.addIssue({
      code: "custom",
      path: ["config", "evaluatorType"],
      message: `Unknown evaluatorType "${evaluatorType}". Pick one of the types in this error's expected list and retry.`,
      params: {
        expected: [...validEvaluatorTypes].toSorted(),
        received: evaluatorType,
      },
    });
  }
}

/** A code evaluator carries its program on `config`, as the editor saves it. */
function refineCodeConfig(config: Record<string, unknown>, ctx: z.RefinementCtx): void {
  const parsed = codeEvaluatorCreateConfigSchema.safeParse(config);
  if (parsed.success) return;
  for (const issue of parsed.error.issues) {
    ctx.addIssue({ code: "custom", path: ["config", ...issue.path], message: issue.message });
  }
}

/** Creating an evaluator: each kind the editor creates, in the shape the editor stores. */
const createEvaluatorInputSchemaDefinition = z
  .object({
    name: z.string().min(1).max(255),
    type: evaluatorTypeSchema
      .default("evaluator")
      .describe(
        'The kind of evaluator. "evaluator" (the default) is a built-in type named by config.evaluatorType; "code" is a custom Python evaluator whose config carries code and inputs; "workflow" wraps the workflow named by workflowId.',
      ),
    config: z
      .record(z.string(), z.unknown())
      .describe(
        "For a built-in evaluator: { evaluatorType, settings }. For a code evaluator: { code, inputs: [{ identifier, type }] }; outputs are the fixed passed, score, label and details. For a workflow evaluator: {}.",
      ),
    workflowId: z
      .string()
      .min(1)
      .optional()
      .describe('The workflow a "workflow" evaluator wraps. Only for type "workflow".'),
  })
  .superRefine((input, ctx) => {
    if (input.type === "workflow") {
      if (input.workflowId === void 0) {
        ctx.addIssue({
          code: "custom",
          path: ["workflowId"],
          message: 'A "workflow" evaluator needs the workflowId of the workflow it wraps.',
        });
      }
      return;
    }
    if (input.workflowId !== void 0) {
      ctx.addIssue({
        code: "custom",
        path: ["workflowId"],
        message:
          'Only a "workflow" evaluator names a workflowId. Set "type": "workflow" or drop it.',
      });
    }
    if (input.type === "code") refineCodeConfig(input.config, ctx);
    else refineBuiltInConfig(input.config, ctx);
  });
export interface CreateEvaluatorInputSchema extends Named<
  typeof createEvaluatorInputSchemaDefinition
> {}
export const createEvaluatorInputSchema: CreateEvaluatorInputSchema =
  createEvaluatorInputSchemaDefinition;

const updateEvaluatorInputSchemaDefinition = z.object({
  name: z.string().min(1).max(255).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  commitMessage: z
    .string()
    .max(500)
    .optional()
    .describe("A note kept on the version this update appends."),
});
export interface UpdateEvaluatorInputSchema extends Named<
  typeof updateEvaluatorInputSchemaDefinition
> {}
export const updateEvaluatorInputSchema: UpdateEvaluatorInputSchema =
  updateEvaluatorInputSchemaDefinition;

/** `?label=` or `?version=` on a single read; the `idOrSlug:label` address is the shorthand. */
const evaluatorRestGetQuerySchemaDefinition = z.object({
  label: evaluatorVersionSelectorSchema.shape.label.describe(
    "A deploy label, for example production. Omit both to read the latest version.",
  ),
  version: evaluatorVersionSelectorSchema.shape.version.describe("A version number."),
});
export interface EvaluatorRestGetQuerySchema extends Named<
  typeof evaluatorRestGetQuerySchemaDefinition
> {}
export const evaluatorRestGetQuerySchema: EvaluatorRestGetQuerySchema =
  evaluatorRestGetQuerySchemaDefinition;

const evaluatorVersionsRestParamsSchemaDefinition = z.object({
  evaluatorId: z.string().min(1).describe("The evaluator id."),
});
export interface EvaluatorVersionsRestParamsSchema extends Named<
  typeof evaluatorVersionsRestParamsSchemaDefinition
> {}
export const evaluatorVersionsRestParamsSchema: EvaluatorVersionsRestParamsSchema =
  evaluatorVersionsRestParamsSchemaDefinition;

const evaluatorLabelRestParamsSchemaDefinition = z.object({
  evaluatorId: z.string().min(1).describe("The evaluator id."),
  label: z.string().min(1).max(64).describe("The deploy label, for example production."),
});
export interface EvaluatorLabelRestParamsSchema extends Named<
  typeof evaluatorLabelRestParamsSchemaDefinition
> {}
export const evaluatorLabelRestParamsSchema: EvaluatorLabelRestParamsSchema =
  evaluatorLabelRestParamsSchemaDefinition;

const evaluatorLabelRestBodySchemaDefinition = z.object({
  version: z.number().int().positive().describe("The version number the label points at."),
});
export interface EvaluatorLabelRestBodySchema extends Named<
  typeof evaluatorLabelRestBodySchemaDefinition
> {}
export const evaluatorLabelRestBodySchema: EvaluatorLabelRestBodySchema =
  evaluatorLabelRestBodySchemaDefinition;

const evaluatorVersionListResponseSchemaDefinition = z.object({
  data: z.array(evaluatorVersionSchema),
  labels: z.array(evaluatorLabelSchema.pick({ label: true, version: true })),
});
export interface EvaluatorVersionListResponseSchema extends Named<
  typeof evaluatorVersionListResponseSchemaDefinition
> {}
export const evaluatorVersionListResponseSchema: EvaluatorVersionListResponseSchema =
  evaluatorVersionListResponseSchemaDefinition;

const evaluatorLabelResponseSchemaDefinition = evaluatorLabelSchema.pick({
  label: true,
  version: true,
  versionId: true,
});
export interface EvaluatorLabelResponseSchema extends Named<
  typeof evaluatorLabelResponseSchemaDefinition
> {}
export const evaluatorLabelResponseSchema: EvaluatorLabelResponseSchema =
  evaluatorLabelResponseSchemaDefinition;

const evaluatorLabelRemovedSchemaDefinition = z.object({
  label: z.string(),
  removed: z.literal(true),
});
export interface EvaluatorLabelRemovedSchema extends Named<
  typeof evaluatorLabelRemovedSchemaDefinition
> {}
export const evaluatorLabelRemovedSchema: EvaluatorLabelRemovedSchema =
  evaluatorLabelRemovedSchemaDefinition;
