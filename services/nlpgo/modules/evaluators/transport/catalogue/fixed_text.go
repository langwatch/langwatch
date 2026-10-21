package catalogue

// The file's fixed text, as langevals' generator wrote it and oxfmt laid it
// out: everything but the two tables the definitions fill.
const (
	fileHead = `import type { Named } from "@langwatch/module";
// Generated from langevals (see services/langevals/scripts/generate_evaluators_ts.py).
// Zod-first: the schemas below are the source of truth and the TypeScript types
// are inferred with z.infer. Do not edit by hand.
import { z } from "zod";

export const evaluatorTypesSchema = z.string();

const moneySchemaDefinition = z.object({
  currency: z.string(),
  amount: z.number(),
});
export interface MoneySchema extends Named<typeof moneySchemaDefinition> {}
export const moneySchema: MoneySchema = moneySchemaDefinition;

const evaluationResultSchemaDefinition = z.object({
  status: z.literal("processed"),
  score: z.number().nullish(),
  passed: z.boolean().nullish(),
  label: z.string().nullish(),
  details: z.string().nullish(),
  cost: moneySchema.nullish(),
  raw_response: z.any().optional(),
});
export interface EvaluationResultSchema extends Named<typeof evaluationResultSchemaDefinition> {}
export const evaluationResultSchema: EvaluationResultSchema = evaluationResultSchemaDefinition;

const evaluationResultSkippedSchemaDefinition = z.object({
  status: z.literal("skipped"),
  details: z.string().nullish(),
  cost: moneySchema.nullish(),
});
export interface EvaluationResultSkippedSchema extends Named<
  typeof evaluationResultSkippedSchemaDefinition
> {}
export const evaluationResultSkippedSchema: EvaluationResultSkippedSchema =
  evaluationResultSkippedSchemaDefinition;

const evaluationResultErrorSchemaDefinition = z.object({
  status: z.literal("error"),
  error_type: z.string(),
  details: z.string(),
  traceback: z.array(z.string()),
});
export interface EvaluationResultErrorSchema extends Named<
  typeof evaluationResultErrorSchemaDefinition
> {}
export const evaluationResultErrorSchema: EvaluationResultErrorSchema =
  evaluationResultErrorSchemaDefinition;

const singleEvaluationResultSchemaDefinition = z.union([
  evaluationResultSchema,
  evaluationResultSkippedSchema,
  evaluationResultErrorSchema,
]);
export interface SingleEvaluationResultSchema extends Named<
  typeof singleEvaluationResultSchemaDefinition
> {}
export const singleEvaluationResultSchema: SingleEvaluationResultSchema =
  singleEvaluationResultSchemaDefinition;

const batchEvaluationResultSchemaDefinition = z.array(singleEvaluationResultSchema);
export interface BatchEvaluationResultSchema extends Named<
  typeof batchEvaluationResultSchemaDefinition
> {}
export const batchEvaluationResultSchema: BatchEvaluationResultSchema =
  batchEvaluationResultSchemaDefinition;

`

	fileMiddle = `
export interface EvaluatorsSchema extends Named<typeof evaluatorsSchemaDefinition> {}
export const evaluatorsSchema: EvaluatorsSchema = evaluatorsSchemaDefinition;

export type Money = z.infer<typeof moneySchema>;
export type EvaluationResult = z.infer<typeof evaluationResultSchema>;
export type EvaluationResultSkipped = z.infer<typeof evaluationResultSkippedSchema>;
export type EvaluationResultError = z.infer<typeof evaluationResultErrorSchema>;
export type SingleEvaluationResult = z.infer<typeof singleEvaluationResultSchema>;
export type BatchEvaluationResult = z.infer<typeof batchEvaluationResultSchema>;
export type Evaluators = z.infer<typeof evaluatorsSchema>;
export type EvaluatorTypes = keyof Evaluators;

export type EvaluatorDefinition<T extends EvaluatorTypes> = {
  name: string;
  description: string;
  category: "quality" | "rag" | "safety" | "policy" | "other" | "custom" | "similarity";
  docsUrl?: string;
  isGuardrail: boolean;
  requiredFields: string[];
  optionalFields: string[];
  settings: {
    [K in keyof Evaluators[T]["settings"]]: {
      description?: string;
      default: Evaluators[T]["settings"][K];
    };
  };
  envVars: string[];
  result: {
    score?: {
      description: string;
    };
    passed?: {
      description: string;
    };
    label?: {
      description: string;
    };
  };
};

export const AVAILABLE_EVALUATORS: {
  [K in EvaluatorTypes]: EvaluatorDefinition<K>;
`
)
