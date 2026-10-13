import { KSUID_RESOURCES, generate } from "@langwatch/ksuid";
import type { Named } from "@langwatch/module";
import { z } from "zod";

/**
 * The Studio graph is deliberately open-ended: new node kinds are shipped by
 * the execution engine independently of this control-plane package. The
 * envelope is strict and the graph values remain portable JSON.
 */
const workflowDslSchemaDefinition = z
  .object({
    workflow_id: z.string().optional(),
    spec_version: z.union([z.string(), z.number()]).optional(),
    version: z.union([z.string(), z.number()]),
    name: z.string().min(1),
    icon: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    nodes: z.array(z.unknown()),
    edges: z.array(z.unknown()),
    state: z.record(z.string(), z.unknown()).optional(),
    workflow_type: z.string().optional(),
    template_adapter: z.string().optional(),
  })
  .passthrough();
export interface WorkflowDslSchema extends Named<typeof workflowDslSchemaDefinition> {}
export const workflowDslSchema: WorkflowDslSchema = workflowDslSchemaDefinition;

export type WorkflowDsl = z.infer<typeof workflowDslSchema>;

export const workflowRunOriginSchema = z.enum([
  "workflow",
  "playground",
  "evaluation",
  "scenario",
  "topic_clustering",
]);
export type WorkflowRunOrigin = z.infer<typeof workflowRunOriginSchema>;

/**
 * What one synchronous workflow run answers with: the execution state the
 * engine finished in, and the workflow's own output fields, keyed by the names
 * the workflow gives them.
 */
const workflowRunAnswerSchemaDefinition = z.object({
  result: z.record(z.string(), z.unknown()).nullable().optional(),
  status: z.enum(["idle", "waiting", "running", "success", "error", "skipped"]),
});
export interface WorkflowRunAnswerSchema extends Named<typeof workflowRunAnswerSchemaDefinition> {}
export const workflowRunAnswerSchema: WorkflowRunAnswerSchema = workflowRunAnswerSchemaDefinition;

export type WorkflowRunAnswer = z.infer<typeof workflowRunAnswerSchema>;

const workflowSchemaDefinition = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  description: z.string().nullable(),
  latestVersionId: z.string().nullable(),
  currentVersionId: z.string().nullable(),
  publishedId: z.string().nullable(),
  publishedById: z.string().nullable(),
  copiedFromWorkflowId: z.string().nullable(),
  isEvaluator: z.boolean(),
  isComponent: z.boolean(),
  archivedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export interface WorkflowSchema extends Named<typeof workflowSchemaDefinition> {}
export const workflowSchema: WorkflowSchema = workflowSchemaDefinition;

export type Workflow = z.infer<typeof workflowSchema>;

const workflowVersionSchemaDefinition = z.object({
  id: z.string(),
  workflowId: z.string(),
  projectId: z.string(),
  version: z.string(),
  autoSaved: z.boolean(),
  commitMessage: z.string(),
  authorId: z.string().nullable(),
  parentId: z.string().nullable(),
  dsl: workflowDslSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});
export interface WorkflowVersionSchema extends Named<typeof workflowVersionSchemaDefinition> {}
export const workflowVersionSchema: WorkflowVersionSchema = workflowVersionSchemaDefinition;

export type WorkflowVersion = z.infer<typeof workflowVersionSchema>;

export const workflowVersionHistoryModeSchema = z.enum(["metadata", "allDsl", "previousDsl"]);

export type WorkflowVersionHistoryMode = z.infer<typeof workflowVersionHistoryModeSchema>;

const workflowVersionHistoryEntrySchemaDefinition = z.object({
  id: z.string(),
  version: z.string(),
  autoSaved: z.boolean(),
  commitMessage: z.string(),
  updatedAt: z.date(),
  dsl: workflowDslSchema.optional(),
  parent: z
    .object({
      id: z.string(),
      version: z.string(),
      commitMessage: z.string(),
    })
    .nullable()
    .optional(),
  author: z.object({ name: z.string().nullable(), image: z.string().nullable() }).nullable(),
  isCurrentVersion: z.literal(true).optional(),
  isLatestVersion: z.literal(true).optional(),
  isPublishedVersion: z.literal(true).optional(),
  isPreviousVersion: z.literal(true).optional(),
});
export interface WorkflowVersionHistoryEntrySchema extends Named<
  typeof workflowVersionHistoryEntrySchemaDefinition
> {}
export const workflowVersionHistoryEntrySchema: WorkflowVersionHistoryEntrySchema =
  workflowVersionHistoryEntrySchemaDefinition;

export type WorkflowVersionHistoryEntry = z.infer<typeof workflowVersionHistoryEntrySchema>;

/** A workflow plus the versions the studio reads alongside it. */
const workflowWithVersionSchemaDefinition = z.object({
  ...workflowSchema.shape,
  currentVersion: workflowVersionSchema.nullable().optional(),
  latestVersion: workflowVersionSchema.nullable().optional(),
});
export interface WorkflowWithVersionSchema extends Named<
  typeof workflowWithVersionSchemaDefinition
> {}
export const workflowWithVersionSchema: WorkflowWithVersionSchema =
  workflowWithVersionSchemaDefinition;

export type WorkflowWithVersion = z.infer<typeof workflowWithVersionSchema>;

const workflowFieldSchemaDefinition = z.object({
  identifier: z.string().min(1),
  type: z.string().min(1),
  optional: z.boolean().optional(),
});
export interface WorkflowFieldSchema extends Named<typeof workflowFieldSchemaDefinition> {}
export const workflowFieldSchema: WorkflowFieldSchema = workflowFieldSchemaDefinition;

/** Open Workflow node refinement used by field-discovery queries. */
const workflowFieldNodeSchemaDefinition = z.looseObject({
  id: z.string(),
  type: z.string().optional(),
  data: z.looseObject({
    inputs: z.array(z.unknown()).optional(),
    outputs: z.array(z.unknown()).optional(),
  }),
});
export interface WorkflowFieldNodeSchema extends Named<typeof workflowFieldNodeSchemaDefinition> {}
export const workflowFieldNodeSchema: WorkflowFieldNodeSchema = workflowFieldNodeSchemaDefinition;

export type WorkflowField = z.infer<typeof workflowFieldSchema>;

/** Portable field metadata consumed by Evaluator without a Workflow repository. */
export type WorkflowEvaluatorFields = {
  workflowId: string;
  workflowName: string;
  workflowIcon?: string;
  fields: WorkflowField[];
  outputFields: WorkflowField[];
};

export function generateWorkflowRunId(): string {
  return `run_${generate(KSUID_RESOURCES.WORKFLOW_TRACE).toString()}`;
}

export function generateWorkflowEdgeId(): string {
  return `edge_${generate(KSUID_RESOURCES.WORKFLOW).toString()}`;
}
