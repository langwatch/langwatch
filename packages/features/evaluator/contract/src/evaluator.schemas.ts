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
import { evaluatorFieldSchema, evaluatorSchema, evaluatorTypeSchema } from "./evaluator";
import type { Evaluator, EvaluatorWithFields } from "./evaluator";

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

/**
 * The create payload a browser sends, as a declared type.
 *
 * The schema is a factory — it takes the id generator, because which id scheme
 * a deployment uses is the process's decision — so the alias is taken over the
 * factory's return rather than over a schema constant.
 *
 * `z.input` rather than `z.infer`, and the difference is load bearing: `id`
 * carries `.default(generateEvaluatorId)`, so the parsed shape has it and what
 * a client SENDS does not. Inferring the parsed shape here would make the id
 * the browser never mints a required field, the way `UpdateAgentCommand` in
 * `@langwatch/agent-contract` already does for its own defaulted keys.
 */
export type EvaluatorApiCreateInput = z.input<ReturnType<typeof evaluatorApiCreateInputSchema>>;

/**
 * What the five reads and writes the studio borrows answer.
 *
 * `Evaluator` and `EvaluatorWithFields` are this contract's own zod-inferred
 * shapes, and {@link EvaluatorService} declares exactly these returns — the
 * Prisma repository parses its rows through `evaluatorSchema` before they get
 * this far — so stating them restates nothing and leaks no Prisma row.
 *
 * `getById` answers `null` rather than refusing: the studio opens the drawer
 * on an evaluator the project may no longer have.
 */
export type EvaluatorApiGetAllOutput = EvaluatorWithFields[];
export type EvaluatorApiGetByIdOutput = EvaluatorWithFields | null;
export type EvaluatorApiCreateOutput = Evaluator;
export type EvaluatorApiUpdateOutput = Evaluator;

/** Deleting archives the row and answers it, so the caller can offer an undo. */
export type EvaluatorApiDeleteOutput = Evaluator;

/**
 * What the evaluator tRPC surface answers with, beyond the evaluator rows
 * above. Each is the shape the procedure already returned.
 */
export const evaluatorCopySchema = z.object({
  id: z.string(),
  name: z.string(),
  projectId: z.string(),
  fullPath: z.string(),
});

export const evaluatorHistoryEntrySchema = z.object({
  id: z.string(),
  action: z.string(),
  createdAt: z.date(),
  args: z.unknown(),
  user: z
    .object({ id: z.string(), name: z.string().nullable(), email: z.string().nullable() })
    .nullable(),
});

/** The entry-node fields a workflow evaluator maps trace data onto. */
export const evaluatorWorkflowFieldsSchema = z.object({
  evaluatorId: z.string(),
  evaluatorType: z.string(),
  workflowId: z.string().optional(),
  workflowName: z.string().optional(),
  workflowIcon: z.string().optional(),
  fields: z.array(evaluatorFieldSchema),
  outputFields: z.array(evaluatorFieldSchema),
});

/** The workflow and monitors an archive would take with the evaluator. */
export const evaluatorRelatedEntitiesSchema = z.object({
  workflow: z.object({ id: z.string(), name: z.string() }).nullable(),
  monitors: z.array(z.object({ id: z.string(), name: z.string() })),
});

/** What a cascade archive took with it. */
export const evaluatorCascadeArchiveSchema = z.object({
  evaluator: evaluatorSchema,
  archivedWorkflow: z.object({ id: z.string() }).nullable(),
  deletedMonitorsCount: z.number(),
});

/** How far a push to the replicas reached. */
export const evaluatorPushToCopiesSchema = z.object({
  pushedTo: z.number(),
  selectedCopies: z.number(),
});

/** A copy pulled back into line with its source. */
export const evaluatorSyncFromSourceSchema = z.object({ ok: z.literal(true) });
