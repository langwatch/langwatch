import type { Named } from "@langwatch/module";
import { z } from "zod";

/** The most projects one outcome count reads; each is its own tenant-scoped query. */
export const EVALUATOR_OUTCOME_MAX_PROJECTS = 50;

/** Online evaluator runs scheduled in `[since, until)`, epoch milliseconds, per project. */
const evaluatorOutcomeCountQuerySchemaDefinition = z.object({
  projectIds: z.array(z.string().min(1)).max(EVALUATOR_OUTCOME_MAX_PROJECTS),
  since: z.number().int(),
  until: z.number().int(),
});
export interface EvaluatorOutcomeCountQuerySchema extends Named<
  typeof evaluatorOutcomeCountQuerySchemaDefinition
> {}
export const evaluatorOutcomeCountQuerySchema: EvaluatorOutcomeCountQuerySchema =
  evaluatorOutcomeCountQuerySchemaDefinition;
export type EvaluatorOutcomeCountQuery = z.infer<typeof evaluatorOutcomeCountQuerySchema>;

const evaluatorErrorCodeCountSchemaDefinition = z.object({
  code: z.string(),
  count: z.number().int().nonnegative(),
});
export interface EvaluatorErrorCodeCountSchema extends Named<
  typeof evaluatorErrorCodeCountSchemaDefinition
> {}
export const evaluatorErrorCodeCountSchema: EvaluatorErrorCodeCountSchema =
  evaluatorErrorCodeCountSchemaDefinition;
export type EvaluatorErrorCodeCount = z.infer<typeof evaluatorErrorCodeCountSchema>;

/** One evaluator's runs in a project: counts and error codes only, never a message. */
const evaluatorOutcomeCountSchemaDefinition = z.object({
  projectId: z.string(),
  evaluatorId: z.string(),
  evaluatorType: z.string(),
  runs: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  errorsByCode: z.array(evaluatorErrorCodeCountSchema),
  lastErrorAt: z.number().int().nullable(),
});
export interface EvaluatorOutcomeCountSchema extends Named<
  typeof evaluatorOutcomeCountSchemaDefinition
> {}
export const evaluatorOutcomeCountSchema: EvaluatorOutcomeCountSchema =
  evaluatorOutcomeCountSchemaDefinition;
export type EvaluatorOutcomeCount = z.infer<typeof evaluatorOutcomeCountSchema>;
