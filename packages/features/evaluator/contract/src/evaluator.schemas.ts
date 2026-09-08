/**
 * The inputs the `evaluators.*` tRPC surface publishes.
 *
 * They live in the contract so the wire shape a client is typed against is
 * stated once, and the two schemas that mint an identifier read the one
 * evaluator-id scheme rather than a second of their own.
 */
import { z } from "zod";
import {
  evaluatorFieldSchema,
  evaluatorSchema,
  evaluatorTypeSchema,
  newEvaluatorId,
} from "./evaluator.ts";
import type { Evaluator, EvaluatorWithFields } from "./evaluator.ts";

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

/** Creating an evaluator. An omitted id is minted before the handler runs. */
export const evaluatorApiCreateInputSchema = z.object({
  // Generated server-side so it's present in audit log args for history lookup
  id: z.string().default(newEvaluatorId),
  projectId: z.string(),
  name: z.string().min(1).max(255),
  type: evaluatorTypeSchema,
  config: z.record(z.string(), z.unknown()),
  workflowId: z.string().optional(),
});

/** Copying an evaluator between projects. An omitted id names the copy. */
export const evaluatorApiCopyInputSchema = z.object({
  evaluatorId: z.string(),
  projectId: z.string(),
  sourceProjectId: z.string(),
  // Generated server-side so it's present in audit log args for history lookup
  newEvaluatorId: z.string().default(newEvaluatorId),
});

export type EvaluatorApiProjectInput = z.infer<typeof evaluatorApiProjectInputSchema>;
export type EvaluatorApiEvaluatorIdInput = z.infer<typeof evaluatorApiEvaluatorIdInputSchema>;
export type EvaluatorApiEvaluatorInput = z.infer<typeof evaluatorApiEvaluatorInputSchema>;
export type EvaluatorApiSlugInput = z.infer<typeof evaluatorApiSlugInputSchema>;
export type EvaluatorApiUpdateInput = z.infer<typeof evaluatorApiUpdateInputSchema>;
export type EvaluatorApiPushToCopiesInput = z.infer<typeof evaluatorApiPushToCopiesInputSchema>;

/**
 * The create payload a browser SENDS. `z.input` rather than `z.infer` is load
 * bearing: `id` carries `.default(newEvaluatorId)`, so the parsed shape has it
 * and the payload does not.
 */
export type EvaluatorApiCreateInput = z.input<typeof evaluatorApiCreateInputSchema>;
export type EvaluatorApiCopyInput = z.infer<typeof evaluatorApiCopyInputSchema>;

/**
 * What the five reads and writes the studio borrows answer, as this contract's
 * own zod-inferred shapes — so nothing here leaks a Prisma row.
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

export type EvaluatorCopy = z.infer<typeof evaluatorCopySchema>;
export type EvaluatorHistoryEntry = z.infer<typeof evaluatorHistoryEntrySchema>;
export type EvaluatorWorkflowFields = z.infer<typeof evaluatorWorkflowFieldsSchema>;
export type EvaluatorRelatedEntities = z.infer<typeof evaluatorRelatedEntitiesSchema>;
export type EvaluatorCascadeArchive = z.infer<typeof evaluatorCascadeArchiveSchema>;
export type EvaluatorPushToCopiesResult = z.infer<typeof evaluatorPushToCopiesSchema>;
export type EvaluatorSyncFromSourceResult = z.infer<typeof evaluatorSyncFromSourceSchema>;
