import type { Named } from "@langwatch/module";
import { z } from "zod";

import { studioWorkflowSchema } from "./studio-workflow.ts";
import { workflowDslSchema, workflowRunOriginSchema } from "./workflow.ts";

const createWorkflowCommandSchemaDefinition = z.object({
  id: z.string().optional(),
  projectId: z.string(),
  dsl: workflowDslSchema,
  commitMessage: z.string(),
  publish: z.boolean().optional(),
  authorId: z.string().optional(),
  /** Stores version one as an autosave that later autosaves update in place; default committed. */
  autoSaved: z.boolean().optional(),
});
export interface CreateWorkflowCommandSchema extends Named<
  typeof createWorkflowCommandSchemaDefinition
> {}
export const createWorkflowCommandSchema: CreateWorkflowCommandSchema =
  createWorkflowCommandSchemaDefinition;

const saveWorkflowVersionCommandSchemaDefinition = z.object({
  projectId: z.string(),
  workflowId: z.string(),
  dsl: workflowDslSchema,
  commitMessage: z.string(),
  autoSaved: z.boolean(),
  authorId: z.string().optional(),
  setAsLatestVersion: z.boolean().optional(),
});
export interface SaveWorkflowVersionCommandSchema extends Named<
  typeof saveWorkflowVersionCommandSchemaDefinition
> {}
export const saveWorkflowVersionCommandSchema: SaveWorkflowVersionCommandSchema =
  saveWorkflowVersionCommandSchemaDefinition;

const updateWorkflowCommandSchemaDefinition = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string().min(1).optional(),
  icon: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});
export interface UpdateWorkflowCommandSchema extends Named<
  typeof updateWorkflowCommandSchemaDefinition
> {}
export const updateWorkflowCommandSchema: UpdateWorkflowCommandSchema =
  updateWorkflowCommandSchemaDefinition;

const archiveWorkflowCommandSchemaDefinition = z.object({
  id: z.string(),
  projectId: z.string(),
  unarchive: z.boolean().optional(),
});
export interface ArchiveWorkflowCommandSchema extends Named<
  typeof archiveWorkflowCommandSchemaDefinition
> {}
export const archiveWorkflowCommandSchema: ArchiveWorkflowCommandSchema =
  archiveWorkflowCommandSchemaDefinition;

const publishWorkflowCommandSchemaDefinition = z.object({
  id: z.string(),
  projectId: z.string(),
  versionId: z.string(),
  actorId: z.string().optional(),
});
export interface PublishWorkflowCommandSchema extends Named<
  typeof publishWorkflowCommandSchemaDefinition
> {}
export const publishWorkflowCommandSchema: PublishWorkflowCommandSchema =
  publishWorkflowCommandSchemaDefinition;

const copyWorkflowCommandSchemaDefinition = z.object({
  sourceWorkflowId: z.string(),
  sourceProjectId: z.string(),
  targetProjectId: z.string(),
  copiedFromWorkflowId: z.string().optional(),
  copyDatasets: z.boolean().optional(),
  id: z.string().optional(),
  authorId: z.string().optional(),
});
export interface CopyWorkflowCommandSchema extends Named<
  typeof copyWorkflowCommandSchemaDefinition
> {}
export const copyWorkflowCommandSchema: CopyWorkflowCommandSchema =
  copyWorkflowCommandSchemaDefinition;

/**
 * Who a run acts as: a member and the key they started it with, or a service key alone. The run's
 * key holds no more than either; only a run that names nobody (a scheduler) acts as the system.
 */
const workflowRunPrincipalSchemaDefinition = z.union([
  z.object({ userId: z.string().min(1), callerApiKeyId: z.string().min(1).optional() }).strict(),
  z.object({ userId: z.null(), callerApiKeyId: z.string().min(1) }).strict(),
]);
export interface WorkflowRunPrincipalSchema extends Named<
  typeof workflowRunPrincipalSchemaDefinition
> {}
export const workflowRunPrincipalSchema: WorkflowRunPrincipalSchema =
  workflowRunPrincipalSchemaDefinition;
export type WorkflowRunPrincipal = z.infer<typeof workflowRunPrincipalSchema>;

/**
 * Dispatch input shared by every workflow transport. The graph is resolved by
 * the service, so callers can only name the workflow and an optional version.
 */
const runWorkflowCommandSchemaDefinition = z.object({
  workflowId: z.string(),
  projectId: z.string(),
  inputs: z.record(z.string(), z.unknown()),
  versionId: z.string().optional(),
  doNotTrace: z.boolean().optional(),
  runEvaluations: z.boolean().optional(),
  origin: workflowRunOriginSchema.optional(),
  causalityDepth: z.number().int().nonnegative().optional(),
  principal: workflowRunPrincipalSchema.optional(),
  parentTrace: z
    .object({
      traceId: z.string(),
      parentSpanId: z.string(),
    })
    .optional(),
});
export interface RunWorkflowCommandSchema extends Named<
  typeof runWorkflowCommandSchemaDefinition
> {}
export const runWorkflowCommandSchema: RunWorkflowCommandSchema =
  runWorkflowCommandSchemaDefinition;

export type CreateWorkflowCommand = z.infer<typeof createWorkflowCommandSchema>;
export type SaveWorkflowVersionCommand = z.infer<typeof saveWorkflowVersionCommandSchema>;
export type UpdateWorkflowCommand = z.infer<typeof updateWorkflowCommandSchema>;
export type ArchiveWorkflowCommand = z.infer<typeof archiveWorkflowCommandSchema>;
export type PublishWorkflowCommand = z.infer<typeof publishWorkflowCommandSchema>;
export type CopyWorkflowCommand = z.infer<typeof copyWorkflowCommandSchema>;
export type RunWorkflowCommand = z.infer<typeof runWorkflowCommandSchema>;

const executeWorkflowComponentInputSchemaDefinition = z.object({
  projectId: z.string().min(1),
  workflow: studioWorkflowSchema,
  nodeId: z.string().min(1),
  traceId: z.string().min(1),
  inputs: z.record(z.string(), z.unknown()),
  origin: z.enum(["agent_test", "workflow"]),
});
export interface ExecuteWorkflowComponentInputSchema extends Named<
  typeof executeWorkflowComponentInputSchemaDefinition
> {}
export const executeWorkflowComponentInputSchema: ExecuteWorkflowComponentInputSchema =
  executeWorkflowComponentInputSchemaDefinition;

export type ExecuteWorkflowComponentInput = z.infer<typeof executeWorkflowComponentInputSchema>;
