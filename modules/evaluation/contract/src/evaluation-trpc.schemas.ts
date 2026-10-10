/**
 * The shapes the `evaluations.*` tRPC door takes and answers with. Door
 * specific: nothing here is part of the callable capability's own vocabulary.
 */
import { evaluatorsSchema } from "@langwatch/evaluator-contract";
import type { Named } from "@langwatch/module";
import { z } from "zod";

/** Every procedure here answers about one project. */
const evaluationProjectScopeSchemaDefinition = z.object({ projectId: z.string() });
export interface EvaluationProjectScopeSchema extends Named<
  typeof evaluationProjectScopeSchemaDefinition
> {}
export const evaluationProjectScopeSchema: EvaluationProjectScopeSchema =
  evaluationProjectScopeSchemaDefinition;
export type EvaluationProjectScope = z.infer<typeof evaluationProjectScopeSchema>;

/** One evaluation in a project, whose inputs the trace drawer's evaluation card expands. */
const evaluationInputsInputSchemaDefinition = z.object({
  projectId: z.string(),
  evaluationId: z.string(),
  /** On an aggregate, the member the drawer is on, which holds the evaluation. */
  tenantId: z.string().min(1).optional(),
});
export interface EvaluationInputsInputSchema extends Named<
  typeof evaluationInputsInputSchemaDefinition
> {}
export const evaluationInputsInputSchema: EvaluationInputsInputSchema =
  evaluationInputsInputSchemaDefinition;

/** What an evaluation was run over, offloaded inputs resolved; null when none are stored. */
const evaluationInputsSchemaDefinition = z.record(z.string(), z.unknown()).nullable();
export interface EvaluationInputsSchema extends Named<typeof evaluationInputsSchemaDefinition> {}
export const evaluationInputsSchema: EvaluationInputsSchema = evaluationInputsSchemaDefinition;

/**
 * A run's field mappings, with no vocabulary attached: which sources a mapping
 * may name is the trace-mapping registry's answer, and that registry is a
 * browser module a server package may not value-import.
 */
const evaluationRunMappingsSchemaDefinition = z
  .looseObject({
    mapping: z.record(z.string(), z.unknown()).default({}),
    expansions: z.array(z.string()).default([]),
  })
  .nullable();
export interface EvaluationRunMappingsSchema extends Named<
  typeof evaluationRunMappingsSchemaDefinition
> {}
export const evaluationRunMappingsSchema: EvaluationRunMappingsSchema =
  evaluationRunMappingsSchemaDefinition;
export type EvaluationRunMappings = z.infer<typeof evaluationRunMappingsSchema>;

/** Which evaluator a re-score names: a built-in id, or a project's own. */
const evaluationRunEvaluatorTypeSchemaDefinition = z.union([
  evaluatorsSchema.keyof(),
  z.string().refine((value) => value.startsWith("custom/")),
]);
export interface EvaluationRunEvaluatorTypeSchema extends Named<
  typeof evaluationRunEvaluatorTypeSchemaDefinition
> {}
export const evaluationRunEvaluatorTypeSchema: EvaluationRunEvaluatorTypeSchema =
  evaluationRunEvaluatorTypeSchemaDefinition;

const runTraceEvaluationInputSchemaDefinition = z.object({
  projectId: z.string(),
  evaluatorType: evaluationRunEvaluatorTypeSchema,
  traceId: z.string(),
  settings: z.looseObject({}),
  mappings: evaluationRunMappingsSchema,
});
export interface RunTraceEvaluationInputSchema extends Named<
  typeof runTraceEvaluationInputSchemaDefinition
> {}
export const runTraceEvaluationInputSchema: RunTraceEvaluationInputSchema =
  runTraceEvaluationInputSchemaDefinition;
export type RunTraceEvaluationInput = z.infer<typeof runTraceEvaluationInputSchema>;

const warmupEvaluatorsInputSchemaDefinition = z.object({
  projectId: z.string(),
  count: z.number().min(1).max(24).default(5),
});
export interface WarmupEvaluatorsInputSchema extends Named<
  typeof warmupEvaluatorsInputSchemaDefinition
> {}
export const warmupEvaluatorsInputSchema: WarmupEvaluatorsInputSchema =
  warmupEvaluatorsInputSchemaDefinition;
export type WarmupEvaluatorsInput = z.infer<typeof warmupEvaluatorsInputSchema>;

/**
 * One workflow-backed evaluator a project published, as the picker and the
 * evaluate doors read it. Loose: the row carries more than either reads, and
 * narrowing it here would drop fields the browser already renders.
 */
const customEvaluatorSchemaDefinition = z.looseObject({
  id: z.string(),
  name: z.string(),
  versions: z.array(z.looseObject({})),
});
export interface CustomEvaluatorSchema extends Named<typeof customEvaluatorSchemaDefinition> {}
export const customEvaluatorSchema: CustomEvaluatorSchema = customEvaluatorSchemaDefinition;
export type CustomEvaluator = z.infer<typeof customEvaluatorSchema>;
