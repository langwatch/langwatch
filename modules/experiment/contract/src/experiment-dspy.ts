import type { Named } from "@langwatch/module";
import { z } from "zod";

const experimentDspyExampleSchemaDefinition = z.object({
  hash: z.string(),
  example: z.record(z.string(), z.unknown()),
  pred: z.record(z.string(), z.unknown()),
  score: z.number(),
  trace: z
    .array(
      z.object({
        input: z.record(z.string(), z.unknown()),
        pred: z.record(z.string(), z.unknown()),
      }),
    )
    .nullable()
    .optional(),
});
export interface ExperimentDspyExampleSchema extends Named<
  typeof experimentDspyExampleSchemaDefinition
> {}
export const experimentDspyExampleSchema: ExperimentDspyExampleSchema =
  experimentDspyExampleSchemaDefinition;

const experimentDspyLlmCallSchemaDefinition = z.object({
  hash: z.string(),
  __class__: z.string(),
  response: z.record(z.string(), z.unknown()),
  model: z.string().nullable().optional(),
  prompt_tokens: z.number().nullable().optional(),
  completion_tokens: z.number().nullable().optional(),
  cost: z.number().nullable().optional(),
});
export interface ExperimentDspyLlmCallSchema extends Named<
  typeof experimentDspyLlmCallSchemaDefinition
> {}
export const experimentDspyLlmCallSchema: ExperimentDspyLlmCallSchema =
  experimentDspyLlmCallSchemaDefinition;

const experimentDspyPredictorSchemaDefinition = z.object({
  name: z.string(),
  predictor: z.record(z.string(), z.unknown()),
});
export interface ExperimentDspyPredictorSchema extends Named<
  typeof experimentDspyPredictorSchemaDefinition
> {}
export const experimentDspyPredictorSchema: ExperimentDspyPredictorSchema =
  experimentDspyPredictorSchemaDefinition;

const experimentDspyStepSchemaDefinition = z.object({
  tenantId: z.string(),
  experimentId: z.string(),
  runId: z.string(),
  stepIndex: z.string(),
  workflowVersionId: z.string().nullable().optional(),
  score: z.number(),
  label: z.string(),
  optimizerName: z.string(),
  optimizerParameters: z.record(z.string(), z.unknown()),
  predictors: z.array(experimentDspyPredictorSchema),
  examples: z.array(experimentDspyExampleSchema),
  llmCalls: z.array(experimentDspyLlmCallSchema),
  createdAt: z.number(),
  insertedAt: z.number(),
  updatedAt: z.number(),
});
export interface ExperimentDspyStepSchema extends Named<
  typeof experimentDspyStepSchemaDefinition
> {}
export const experimentDspyStepSchema: ExperimentDspyStepSchema =
  experimentDspyStepSchemaDefinition;

const experimentDspyStepSummarySchemaDefinition = z.object({
  ...experimentDspyStepSchema.pick({
    tenantId: true,
    experimentId: true,
    runId: true,
    stepIndex: true,
    workflowVersionId: true,
    score: true,
    label: true,
    optimizerName: true,
    createdAt: true,
  }).shape,
  llmCallsTotal: z.number(),
  llmCallsTotalTokens: z.number(),
  llmCallsTotalCost: z.number(),
});
export interface ExperimentDspyStepSummarySchema extends Named<
  typeof experimentDspyStepSummarySchemaDefinition
> {}
export const experimentDspyStepSummarySchema: ExperimentDspyStepSummarySchema =
  experimentDspyStepSummarySchemaDefinition;

const experimentDspyStepLookupSchemaDefinition = z.object({
  tenantId: z.string(),
  experimentId: z.string(),
  runId: z.string(),
  stepIndex: z.string(),
});
export interface ExperimentDspyStepLookupSchema extends Named<
  typeof experimentDspyStepLookupSchemaDefinition
> {}
export const experimentDspyStepLookupSchema: ExperimentDspyStepLookupSchema =
  experimentDspyStepLookupSchemaDefinition;

const experimentDspyStepsLookupSchemaDefinition = experimentDspyStepLookupSchema.pick({
  tenantId: true,
  experimentId: true,
});
export interface ExperimentDspyStepsLookupSchema extends Named<
  typeof experimentDspyStepsLookupSchemaDefinition
> {}
export const experimentDspyStepsLookupSchema: ExperimentDspyStepsLookupSchema =
  experimentDspyStepsLookupSchemaDefinition;

export type ExperimentDspyExample = z.infer<typeof experimentDspyExampleSchema>;
export type ExperimentDspyLlmCall = z.infer<typeof experimentDspyLlmCallSchema>;
export type ExperimentDspyPredictor = z.infer<typeof experimentDspyPredictorSchema>;
export type ExperimentDspyStep = z.infer<typeof experimentDspyStepSchema>;
export type ExperimentDspyStepSummary = z.infer<typeof experimentDspyStepSummarySchema>;
export type ExperimentDspyStepLookup = z.infer<typeof experimentDspyStepLookupSchema>;
export type ExperimentDspyStepsLookup = z.infer<typeof experimentDspyStepsLookupSchema>;
