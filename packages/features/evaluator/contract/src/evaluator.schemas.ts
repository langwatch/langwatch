/**
 * The inputs the `evaluators.*` tRPC surface publishes.
 *
 * They live in the contract rather than beside the router so the wire shape a
 * client is typed against is stated once, in the package both sides may import.
 *
 * The two schemas that mint an identifier take the generator as a parameter.
 * This package depends on zod and the handled-error contract and nothing else
 * on purpose, and which id scheme a deployment uses is the process's decision
 * rather than the contract's.
 */
import { z } from "zod";
import { evaluatorTypeSchema } from "./evaluator";

/** One project. The list read names it and nothing else. */
export const evaluatorApiProjectInputSchema = z.object({ projectId: z.string() });

/** One evaluator inside one project, addressed by `id`. */
export const evaluatorApiEvaluatorIdInputSchema = z.object({
  id: z.string(),
  projectId: z.string(),
});

/**
 * One evaluator inside one project, addressed by `evaluatorId`. The same pair
 * as `evaluatorApiEvaluatorIdInputSchema` under the field name the copy-lineage
 * and history procedures have always published, which is why both exist.
 */
export const evaluatorApiEvaluatorInputSchema = z.object({
  projectId: z.string(),
  evaluatorId: z.string(),
});

/** One evaluator inside one project, addressed by its slug. */
export const evaluatorApiSlugInputSchema = z.object({
  slug: z.string(),
  projectId: z.string(),
});

export const evaluatorApiUpdateInputSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string().min(1).max(255).optional(),
  type: evaluatorTypeSchema.optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  workflowId: z.string().nullable().optional(),
});

export const evaluatorApiPushToCopiesInputSchema = z.object({
  projectId: z.string(),
  evaluatorId: z.string(),
  copyIds: z.array(z.string()).optional(),
});

/** Creating an evaluator. `generateEvaluatorId` supplies an omitted id. */
export function evaluatorApiCreateInputSchema(generateEvaluatorId: () => string) {
  return z.object({
    // Generated server-side so it's present in audit log args for history lookup
    id: z.string().default(generateEvaluatorId),
    projectId: z.string(),
    name: z.string().min(1).max(255),
    type: evaluatorTypeSchema,
    config: z.record(z.string(), z.unknown()),
    workflowId: z.string().optional(),
  });
}

/** Copying an evaluator between projects. `generateEvaluatorId` names the copy. */
export function evaluatorApiCopyInputSchema(generateEvaluatorId: () => string) {
  return z.object({
    evaluatorId: z.string(),
    projectId: z.string(),
    sourceProjectId: z.string(),
    // Generated server-side so it's present in audit log args for history lookup
    newEvaluatorId: z.string().default(generateEvaluatorId),
  });
}

export type EvaluatorApiProjectInput = z.infer<typeof evaluatorApiProjectInputSchema>;
export type EvaluatorApiEvaluatorIdInput = z.infer<typeof evaluatorApiEvaluatorIdInputSchema>;
export type EvaluatorApiEvaluatorInput = z.infer<typeof evaluatorApiEvaluatorInputSchema>;
export type EvaluatorApiSlugInput = z.infer<typeof evaluatorApiSlugInputSchema>;
export type EvaluatorApiUpdateInput = z.infer<typeof evaluatorApiUpdateInputSchema>;
export type EvaluatorApiPushToCopiesInput = z.infer<typeof evaluatorApiPushToCopiesInputSchema>;
