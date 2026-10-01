/**
 * The shapes the `evaluations.*` tRPC door takes and answers with. Door
 * specific: nothing here is part of the callable capability's own vocabulary.
 */
import { evaluatorsSchema } from "@langwatch/evaluator-contract";
import { z } from "zod";

/** Every procedure here answers about one project. */
export const evaluationProjectScopeSchema = z.object({ projectId: z.string() });
export type EvaluationProjectScope = z.infer<typeof evaluationProjectScopeSchema>;

/**
 * A run's field mappings, with no vocabulary attached: which sources a mapping
 * may name is the trace-mapping registry's answer, and that registry is a
 * browser module a server package may not value-import.
 */
export const evaluationRunMappingsSchema = z
  .looseObject({
    mapping: z.record(z.string(), z.unknown()).default({}),
    expansions: z.array(z.string()).default([]),
  })
  .nullable();
export type EvaluationRunMappings = z.infer<typeof evaluationRunMappingsSchema>;

/** Which evaluator a re-score names: a built-in id, or a project's own. */
export const evaluationRunEvaluatorTypeSchema = z.union([
  evaluatorsSchema.keyof(),
  z.string().refine((value) => value.startsWith("custom/")),
]);

export const runTraceEvaluationInputSchema = z.object({
  projectId: z.string(),
  evaluatorType: evaluationRunEvaluatorTypeSchema,
  traceId: z.string(),
  settings: z.looseObject({}),
  mappings: evaluationRunMappingsSchema,
});
export type RunTraceEvaluationInput = z.infer<typeof runTraceEvaluationInputSchema>;

export const warmupEvaluatorsInputSchema = z.object({
  projectId: z.string(),
  count: z.number().min(1).max(24).default(5),
});
export type WarmupEvaluatorsInput = z.infer<typeof warmupEvaluatorsInputSchema>;

/**
 * One workflow-backed evaluator a project published, as the picker and the
 * evaluate doors read it. Loose: the row carries more than either reads, and
 * narrowing it here would drop fields the browser already renders.
 */
export const customEvaluatorSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  versions: z.array(z.looseObject({})),
});
export type CustomEvaluator = z.infer<typeof customEvaluatorSchema>;
