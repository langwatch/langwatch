import type { Named } from "@langwatch/module";
/**
 * The inputs the `evaluators.*` tRPC surface publishes, kept in the
 * contract so the wire shape a client is typed against is stated once,
 * and identifier-minting schemas share one evaluator-id scheme.
 */
import { z } from "zod";

import {
  evaluatorFieldSchema,
  evaluatorSchema,
  evaluatorTypeSchema,
  newEvaluatorId,
} from "./evaluator.ts";
import type { Evaluator, EvaluatorWithFields } from "./evaluator.ts";
import { evaluatorsSchema } from "./evaluators.generated.ts";

/** One project. The list read names it and nothing else. */
const evaluatorApiProjectInputSchemaDefinition = z.object({ projectId: z.string() });
export interface EvaluatorApiProjectInputSchema extends Named<
  typeof evaluatorApiProjectInputSchemaDefinition
> {}
export const evaluatorApiProjectInputSchema: EvaluatorApiProjectInputSchema =
  evaluatorApiProjectInputSchemaDefinition;

/** One evaluator inside one project, addressed by `id`. */
const evaluatorApiEvaluatorIdInputSchemaDefinition = z.object({
  id: z.string(),
  projectId: z.string(),
});
export interface EvaluatorApiEvaluatorIdInputSchema extends Named<
  typeof evaluatorApiEvaluatorIdInputSchemaDefinition
> {}
export const evaluatorApiEvaluatorIdInputSchema: EvaluatorApiEvaluatorIdInputSchema =
  evaluatorApiEvaluatorIdInputSchemaDefinition;

/**
 * One evaluator inside one project, addressed by `evaluatorId`. The same pair
 * as `evaluatorApiEvaluatorIdInputSchema` under the field name the copy-lineage
 * and history procedures have always published, which is why both exist.
 */
const evaluatorApiEvaluatorInputSchemaDefinition = z.object({
  projectId: z.string(),
  evaluatorId: z.string(),
});
export interface EvaluatorApiEvaluatorInputSchema extends Named<
  typeof evaluatorApiEvaluatorInputSchemaDefinition
> {}
export const evaluatorApiEvaluatorInputSchema: EvaluatorApiEvaluatorInputSchema =
  evaluatorApiEvaluatorInputSchemaDefinition;

/** One evaluator inside one project, addressed by its slug. */
const evaluatorApiSlugInputSchemaDefinition = z.object({
  slug: z.string(),
  projectId: z.string(),
});
export interface EvaluatorApiSlugInputSchema extends Named<
  typeof evaluatorApiSlugInputSchemaDefinition
> {}
export const evaluatorApiSlugInputSchema: EvaluatorApiSlugInputSchema =
  evaluatorApiSlugInputSchemaDefinition;

const evaluatorApiUpdateInputSchemaDefinition = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string().min(1).max(255).optional(),
  type: evaluatorTypeSchema.optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  workflowId: z.string().nullable().optional(),
});
export interface EvaluatorApiUpdateInputSchema extends Named<
  typeof evaluatorApiUpdateInputSchemaDefinition
> {}
export const evaluatorApiUpdateInputSchema: EvaluatorApiUpdateInputSchema =
  evaluatorApiUpdateInputSchemaDefinition;

const evaluatorApiPushToCopiesInputSchemaDefinition = z.object({
  projectId: z.string(),
  evaluatorId: z.string(),
  copyIds: z.array(z.string()).optional(),
});
export interface EvaluatorApiPushToCopiesInputSchema extends Named<
  typeof evaluatorApiPushToCopiesInputSchemaDefinition
> {}
export const evaluatorApiPushToCopiesInputSchema: EvaluatorApiPushToCopiesInputSchema =
  evaluatorApiPushToCopiesInputSchemaDefinition;

/** Creating an evaluator. An omitted id is minted before the handler runs. */
const evaluatorApiCreateInputSchemaDefinition = z.object({
  // Generated server-side so it's present in audit log args for history lookup
  id: z.string().default(newEvaluatorId),
  projectId: z.string(),
  name: z.string().min(1).max(255),
  type: evaluatorTypeSchema,
  config: z.record(z.string(), z.unknown()),
  workflowId: z.string().optional(),
});
export interface EvaluatorApiCreateInputSchema extends Named<
  typeof evaluatorApiCreateInputSchemaDefinition
> {}
export const evaluatorApiCreateInputSchema: EvaluatorApiCreateInputSchema =
  evaluatorApiCreateInputSchemaDefinition;

/** Copying an evaluator between projects. An omitted id names the copy. */
const evaluatorApiCopyInputSchemaDefinition = z.object({
  evaluatorId: z.string(),
  projectId: z.string(),
  sourceProjectId: z.string(),
  // Generated server-side so it's present in audit log args for history lookup
  newEvaluatorId: z.string().default(newEvaluatorId),
});
export interface EvaluatorApiCopyInputSchema extends Named<
  typeof evaluatorApiCopyInputSchemaDefinition
> {}
export const evaluatorApiCopyInputSchema: EvaluatorApiCopyInputSchema =
  evaluatorApiCopyInputSchemaDefinition;

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
 * The five studio-borrowed reads/writes answer as this contract's own
 * zod shapes, so nothing leaks a Prisma row. `getById` returns `null`
 * for a since-deleted evaluator instead of refusing.
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
const evaluatorCopySchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  projectId: z.string(),
  fullPath: z.string(),
});
export interface EvaluatorCopySchema extends Named<typeof evaluatorCopySchemaDefinition> {}
export const evaluatorCopySchema: EvaluatorCopySchema = evaluatorCopySchemaDefinition;

const evaluatorHistoryEntrySchemaDefinition = z.object({
  id: z.string(),
  action: z.string(),
  createdAt: z.date(),
  args: z.unknown(),
  user: z
    .object({ id: z.string(), name: z.string().nullable(), email: z.string().nullable() })
    .nullable(),
});
export interface EvaluatorHistoryEntrySchema extends Named<
  typeof evaluatorHistoryEntrySchemaDefinition
> {}
export const evaluatorHistoryEntrySchema: EvaluatorHistoryEntrySchema =
  evaluatorHistoryEntrySchemaDefinition;

/** The entry-node fields a workflow evaluator maps trace data onto. */
const evaluatorWorkflowFieldsSchemaDefinition = z.object({
  evaluatorId: z.string(),
  evaluatorType: z.string(),
  workflowId: z.string().optional(),
  workflowName: z.string().optional(),
  workflowIcon: z.string().optional(),
  fields: z.array(evaluatorFieldSchema),
  outputFields: z.array(evaluatorFieldSchema),
});
export interface EvaluatorWorkflowFieldsSchema extends Named<
  typeof evaluatorWorkflowFieldsSchemaDefinition
> {}
export const evaluatorWorkflowFieldsSchema: EvaluatorWorkflowFieldsSchema =
  evaluatorWorkflowFieldsSchemaDefinition;

/** The workflow an archive would take with the evaluator; monitor answers for its own rows. */
const evaluatorRelatedEntitiesSchemaDefinition = z.object({
  workflow: z.object({ id: z.string(), name: z.string() }).nullable(),
});
export interface EvaluatorRelatedEntitiesSchema extends Named<
  typeof evaluatorRelatedEntitiesSchemaDefinition
> {}
export const evaluatorRelatedEntitiesSchema: EvaluatorRelatedEntitiesSchema =
  evaluatorRelatedEntitiesSchemaDefinition;

/** One evaluator a workflow backs, as a workflow's archive preview names it. */
const evaluatorByWorkflowSchemaDefinition = z.object({ id: z.string(), name: z.string() });
export interface EvaluatorByWorkflowSchema extends Named<
  typeof evaluatorByWorkflowSchemaDefinition
> {}
export const evaluatorByWorkflowSchema: EvaluatorByWorkflowSchema =
  evaluatorByWorkflowSchemaDefinition;

/** What a cascade archive took with it. */
const evaluatorCascadeArchiveSchemaDefinition = z.object({
  evaluator: evaluatorSchema,
  archivedWorkflow: z.object({ id: z.string() }).nullable(),
});
export interface EvaluatorCascadeArchiveSchema extends Named<
  typeof evaluatorCascadeArchiveSchemaDefinition
> {}
export const evaluatorCascadeArchiveSchema: EvaluatorCascadeArchiveSchema =
  evaluatorCascadeArchiveSchemaDefinition;

/** How far a push to the replicas reached. */
const evaluatorPushToCopiesSchemaDefinition = z.object({
  pushedTo: z.number(),
  selectedCopies: z.number(),
});
export interface EvaluatorPushToCopiesSchema extends Named<
  typeof evaluatorPushToCopiesSchemaDefinition
> {}
export const evaluatorPushToCopiesSchema: EvaluatorPushToCopiesSchema =
  evaluatorPushToCopiesSchemaDefinition;

/** A copy pulled back into line with its source. */
const evaluatorSyncFromSourceSchemaDefinition = z.object({ ok: z.literal(true) });
export interface EvaluatorSyncFromSourceSchema extends Named<
  typeof evaluatorSyncFromSourceSchemaDefinition
> {}
export const evaluatorSyncFromSourceSchema: EvaluatorSyncFromSourceSchema =
  evaluatorSyncFromSourceSchemaDefinition;

/** One workflow inside one project: the Optimization Studio's evaluator switch is scoped by it. */
const evaluatorApiWorkflowInputSchemaDefinition = z.object({
  workflowId: z.string(),
  projectId: z.string(),
});
export interface EvaluatorApiWorkflowInputSchema extends Named<
  typeof evaluatorApiWorkflowInputSchemaDefinition
> {}
export const evaluatorApiWorkflowInputSchema: EvaluatorApiWorkflowInputSchema =
  evaluatorApiWorkflowInputSchemaDefinition;

/** The studio's save-as-evaluator switch; `isComponent` is sent and ignored, as it always was. */
const evaluatorApiWorkflowToggleInputSchemaDefinition = z.object({
  ...evaluatorApiWorkflowInputSchema.shape,
  isEvaluator: z.boolean(),
  isComponent: z.boolean(),
});
export interface EvaluatorApiWorkflowToggleInputSchema extends Named<
  typeof evaluatorApiWorkflowToggleInputSchemaDefinition
> {}
export const evaluatorApiWorkflowToggleInputSchema: EvaluatorApiWorkflowToggleInputSchema =
  evaluatorApiWorkflowToggleInputSchemaDefinition;

/** What a studio switch answers once the write is done. */
const evaluatorWorkflowSwitchedSchemaDefinition = z.object({ success: z.boolean() }).strict();
export interface EvaluatorWorkflowSwitchedSchema extends Named<
  typeof evaluatorWorkflowSwitchedSchemaDefinition
> {}
export const evaluatorWorkflowSwitchedSchema: EvaluatorWorkflowSwitchedSchema =
  evaluatorWorkflowSwitchedSchemaDefinition;

export type EvaluatorCopy = z.infer<typeof evaluatorCopySchema>;
export type EvaluatorHistoryEntry = z.infer<typeof evaluatorHistoryEntrySchema>;
export type EvaluatorWorkflowFields = z.infer<typeof evaluatorWorkflowFieldsSchema>;
export type EvaluatorRelatedEntities = z.infer<typeof evaluatorRelatedEntitiesSchema>;
export type EvaluatorCascadeArchive = z.infer<typeof evaluatorCascadeArchiveSchema>;
export type EvaluatorPushToCopiesResult = z.infer<typeof evaluatorPushToCopiesSchema>;
export type EvaluatorSyncFromSourceResult = z.infer<typeof evaluatorSyncFromSourceSchema>;

type SettingsSchema = z.ZodType<Record<string, unknown>, Record<string, unknown>>;

const settingsSchemas: Readonly<Record<string, SettingsSchema>> = Object.fromEntries(
  Object.entries(evaluatorsSchema.shape).map(([type, schema]) => [type, schema.shape.settings]),
);

/** A built-in evaluator's settings schema; custom and retired evaluators have none. */
export type EvaluatorSettingsSchemaLookup =
  | { found: true; schema: SettingsSchema }
  | { found: false };

export function evaluatorSettingsSchemaFor(checkType: string): EvaluatorSettingsSchemaLookup {
  const schema = settingsSchemas[checkType];
  return schema ? { found: true, schema } : { found: false };
}
