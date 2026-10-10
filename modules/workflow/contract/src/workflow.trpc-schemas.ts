import type { Named } from "@langwatch/module";
import { z } from "zod";

import { studioWorkflowSchema } from "./studio-workflow.ts";
import { workflowSchema, workflowVersionSchema } from "./workflow.ts";
import type {
  Workflow,
  WorkflowVersion,
  WorkflowVersionHistoryEntry,
  WorkflowWithVersion,
} from "./workflow.ts";

/**
 * The transport inputs the workflow surface publishes. They live in the
 * contract, not beside the router, because two different clients are typed
 * against them: the application's tRPC transport and the studio's own client.
 */

/** One project. Every project-scoped procedure on the surface takes it. */
const workflowApiProjectInputSchemaDefinition = z.object({
  projectId: z.string(),
});
export interface WorkflowApiProjectInputSchema extends Named<
  typeof workflowApiProjectInputSchemaDefinition
> {}
export const workflowApiProjectInputSchema: WorkflowApiProjectInputSchema =
  workflowApiProjectInputSchemaDefinition;

/** One workflow inside one project. */
const workflowApiWorkflowInputSchemaDefinition = z.object({
  projectId: z.string(),
  workflowId: z.string(),
});
export interface WorkflowApiWorkflowInputSchema extends Named<
  typeof workflowApiWorkflowInputSchemaDefinition
> {}
export const workflowApiWorkflowInputSchema: WorkflowApiWorkflowInputSchema =
  workflowApiWorkflowInputSchemaDefinition;

/** `engineMode` names the project it asks about, and nothing else. */
export const workflowApiEngineModeInputSchema = workflowApiProjectInputSchema;

/** `getById` names one workflow. */
export const workflowApiGetByIdInputSchema = workflowApiWorkflowInputSchema;

const workflowApiGetVersionsInputSchemaDefinition = z.object({
  projectId: z.string(),
  workflowId: z.string(),
  returnDSL: z.union([z.boolean(), z.literal("previousVersion")]).optional(),
});
export interface WorkflowApiGetVersionsInputSchema extends Named<
  typeof workflowApiGetVersionsInputSchemaDefinition
> {}
export const workflowApiGetVersionsInputSchema: WorkflowApiGetVersionsInputSchema =
  workflowApiGetVersionsInputSchemaDefinition;

const workflowApiCreateInputSchemaDefinition = z.object({
  projectId: z.string(),
  dsl: studioWorkflowSchema,
  commitMessage: z.string(),
  /** Auto-publish the first version (useful for evaluator workflows). */
  publish: z.boolean().optional(),
});
export interface WorkflowApiCreateInputSchema extends Named<
  typeof workflowApiCreateInputSchemaDefinition
> {}
export const workflowApiCreateInputSchema: WorkflowApiCreateInputSchema =
  workflowApiCreateInputSchemaDefinition;

const workflowApiCopyInputSchemaDefinition = z.object({
  workflowId: z.string(),
  projectId: z.string(),
  sourceProjectId: z.string(),
  copyDatasets: z.boolean().optional(),
});
export interface WorkflowApiCopyInputSchema extends Named<
  typeof workflowApiCopyInputSchemaDefinition
> {}
export const workflowApiCopyInputSchema: WorkflowApiCopyInputSchema =
  workflowApiCopyInputSchemaDefinition;

const workflowApiRestoreVersionInputSchemaDefinition = z.object({
  projectId: z.string(),
  versionId: z.string(),
});
export interface WorkflowApiRestoreVersionInputSchema extends Named<
  typeof workflowApiRestoreVersionInputSchemaDefinition
> {}
export const workflowApiRestoreVersionInputSchema: WorkflowApiRestoreVersionInputSchema =
  workflowApiRestoreVersionInputSchemaDefinition;

const workflowApiAutosaveInputSchemaDefinition = z.object({
  projectId: z.string(),
  workflowId: z.string(),
  dsl: studioWorkflowSchema,
  setAsLatestVersion: z.boolean(),
});
export interface WorkflowApiAutosaveInputSchema extends Named<
  typeof workflowApiAutosaveInputSchemaDefinition
> {}
export const workflowApiAutosaveInputSchema: WorkflowApiAutosaveInputSchema =
  workflowApiAutosaveInputSchemaDefinition;

const workflowApiCommitVersionInputSchemaDefinition = z.object({
  projectId: z.string(),
  workflowId: z.string(),
  commitMessage: z.string(),
  dsl: studioWorkflowSchema,
});
export interface WorkflowApiCommitVersionInputSchema extends Named<
  typeof workflowApiCommitVersionInputSchemaDefinition
> {}
export const workflowApiCommitVersionInputSchema: WorkflowApiCommitVersionInputSchema =
  workflowApiCommitVersionInputSchemaDefinition;

const workflowApiPublishInputSchemaDefinition = z.object({
  projectId: z.string(),
  workflowId: z.string(),
  versionId: z.string(),
});
export interface WorkflowApiPublishInputSchema extends Named<
  typeof workflowApiPublishInputSchemaDefinition
> {}
export const workflowApiPublishInputSchema: WorkflowApiPublishInputSchema =
  workflowApiPublishInputSchemaDefinition;

const workflowApiPushToCopiesInputSchemaDefinition = z.object({
  projectId: z.string(),
  workflowId: z.string(),
  /** When present, only these copies are pushed to. */
  copyIds: z.array(z.string()).optional(),
});
export interface WorkflowApiPushToCopiesInputSchema extends Named<
  typeof workflowApiPushToCopiesInputSchemaDefinition
> {}
export const workflowApiPushToCopiesInputSchema: WorkflowApiPushToCopiesInputSchema =
  workflowApiPushToCopiesInputSchemaDefinition;

const workflowApiArchiveInputSchemaDefinition = z.object({
  projectId: z.string(),
  workflowId: z.string(),
  unarchive: z.boolean().optional(),
});
export interface WorkflowApiArchiveInputSchema extends Named<
  typeof workflowApiArchiveInputSchemaDefinition
> {}
export const workflowApiArchiveInputSchema: WorkflowApiArchiveInputSchema =
  workflowApiArchiveInputSchemaDefinition;

const workflowApiGenerateCommitMessageInputSchemaDefinition = z.object({
  projectId: z.string(),
  prevDsl: studioWorkflowSchema,
  newDsl: studioWorkflowSchema,
});
export interface WorkflowApiGenerateCommitMessageInputSchema extends Named<
  typeof workflowApiGenerateCommitMessageInputSchemaDefinition
> {}
export const workflowApiGenerateCommitMessageInputSchema: WorkflowApiGenerateCommitMessageInputSchema =
  workflowApiGenerateCommitMessageInputSchemaDefinition;

export type WorkflowApiProjectInput = z.infer<typeof workflowApiProjectInputSchema>;
export type WorkflowApiWorkflowInput = z.infer<typeof workflowApiWorkflowInputSchema>;
export type WorkflowApiCreateInput = z.infer<typeof workflowApiCreateInputSchema>;
export type WorkflowApiCopyInput = z.infer<typeof workflowApiCopyInputSchema>;
export type WorkflowApiRestoreVersionInput = z.infer<typeof workflowApiRestoreVersionInputSchema>;
export type WorkflowApiAutosaveInput = z.infer<typeof workflowApiAutosaveInputSchema>;
export type WorkflowApiCommitVersionInput = z.infer<typeof workflowApiCommitVersionInputSchema>;
export type WorkflowApiPublishInput = z.infer<typeof workflowApiPublishInputSchema>;
export type WorkflowApiPushToCopiesInput = z.infer<typeof workflowApiPushToCopiesInputSchema>;
export type WorkflowApiArchiveInput = z.infer<typeof workflowApiArchiveInputSchema>;
export type WorkflowApiGenerateCommitMessageInput = z.infer<
  typeof workflowApiGenerateCommitMessageInputSchema
>;

export type WorkflowApiEngineModeInput = z.infer<typeof workflowApiEngineModeInputSchema>;
export type WorkflowApiGetByIdInput = z.infer<typeof workflowApiGetByIdInputSchema>;
export type WorkflowApiGetVersionsInput = z.infer<typeof workflowApiGetVersionsInputSchema>;

/**
 * Optimization was DSPy-only and the Go engine never shipped DSPy, so the
 * studio's Optimize button is always hidden.
 */
export type WorkflowApiEngineModeOutput = {
  engineMode: "go";
  optimizeEnabled: false;
};

export type WorkflowApiGetByIdOutput = WorkflowWithVersion;
export type WorkflowApiGetVersionsOutput = WorkflowVersionHistoryEntry[];

/**
 * Five studio writes answered with the rows they wrote (zod-inferred DTOs, no Prisma leaks).
 */
export type WorkflowApiAutosaveOutput = WorkflowVersion;
export type WorkflowApiCommitVersionOutput = WorkflowVersion;
export type WorkflowApiRestoreVersionOutput = WorkflowVersion;
export type WorkflowApiPublishOutput = Workflow;

/**
 * The generated message itself, and `"no changes"` when the two graphs
 * normalise to the same text and no model was asked.
 */
export type WorkflowApiGenerateCommitMessageOutput = string;

/** What the studio's flag writes answer with: the write landed. */
const workflowWriteAcknowledgedSchemaDefinition = z.object({ success: z.boolean() }).strict();
export interface WorkflowWriteAcknowledgedSchema extends Named<
  typeof workflowWriteAcknowledgedSchemaDefinition
> {}
export const workflowWriteAcknowledgedSchema: WorkflowWriteAcknowledgedSchema =
  workflowWriteAcknowledgedSchemaDefinition;

/** Where a workflow lives, as the copy lists render the path. */
const workflowProjectPathSchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  team: z.object({
    id: z.string(),
    name: z.string(),
    organization: z.object({ id: z.string(), name: z.string() }),
  }),
});
export interface WorkflowProjectPathSchema extends Named<
  typeof workflowProjectPathSchemaDefinition
> {}
export const workflowProjectPathSchema: WorkflowProjectPathSchema =
  workflowProjectPathSchemaDefinition;

/**
 * A listed workflow with its copy lineage redacted to what the caller may see.
 */
const workflowListRowSchemaDefinition = z.object({
  ...workflowSchema.shape,
  copiedFrom: z
    .object({
      id: z.string(),
      name: z.string(),
      projectId: z.string(),
      project: workflowProjectPathSchema,
    })
    .nullable(),
  _count: z.object({ copiedWorkflows: z.number() }),
});
export interface WorkflowListRowSchema extends Named<typeof workflowListRowSchemaDefinition> {}
export const workflowListRowSchema: WorkflowListRowSchema = workflowListRowSchemaDefinition;

/** One copy the caller may push to, with the path it lives under. */
const workflowCopyRowSchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  teamName: z.string(),
  organizationName: z.string(),
  fullPath: z.string(),
  hasPermission: z.boolean(),
});
export interface WorkflowCopyRowSchema extends Named<typeof workflowCopyRowSchemaDefinition> {}
export const workflowCopyRowSchema: WorkflowCopyRowSchema = workflowCopyRowSchemaDefinition;

/** A workflow and the version a write created alongside it. */
const workflowWithNewVersionSchemaDefinition = z.object({
  workflow: workflowSchema,
  version: workflowVersionSchema,
});
export interface WorkflowWithNewVersionSchema extends Named<
  typeof workflowWithNewVersionSchemaDefinition
> {}
export const workflowWithNewVersionSchema: WorkflowWithNewVersionSchema =
  workflowWithNewVersionSchemaDefinition;

/** Which NLP engine is active, and whether Optimize is offered. */
const workflowEngineModeSchemaDefinition = z.object({
  engineMode: z.literal("go"),
  optimizeEnabled: z.literal(false),
});
export interface WorkflowEngineModeSchema extends Named<
  typeof workflowEngineModeSchemaDefinition
> {}
export const workflowEngineModeSchema: WorkflowEngineModeSchema =
  workflowEngineModeSchemaDefinition;

/** How far a push to the copies reached, and what each one wrote. */
const workflowPushToCopiesSchemaDefinition = z.object({
  pushedTo: z.number(),
  totalCopies: z.number(),
  selectedCopies: z.number(),
  results: z.array(
    z.object({ copyId: z.string(), copyName: z.string(), version: workflowVersionSchema }),
  ),
});
export interface WorkflowPushToCopiesSchema extends Named<
  typeof workflowPushToCopiesSchemaDefinition
> {}
export const workflowPushToCopiesSchema: WorkflowPushToCopiesSchema =
  workflowPushToCopiesSchemaDefinition;

/** What archiving a workflow takes with it; its evaluators and monitors are their owners'. */
const workflowRelatedEntitiesSchemaDefinition = z.object({
  agents: z.array(z.object({ id: z.string(), name: z.string() })),
});
export interface WorkflowRelatedEntitiesSchema extends Named<
  typeof workflowRelatedEntitiesSchemaDefinition
> {}
export const workflowRelatedEntitiesSchema: WorkflowRelatedEntitiesSchema =
  workflowRelatedEntitiesSchemaDefinition;

/** What `cascadeArchive` archived at once; evaluators and their monitors follow after a lag. */
const workflowCascadeArchiveSchemaDefinition = z.object({
  workflow: workflowSchema,
  archivedAgentsCount: z.number(),
});
export interface WorkflowCascadeArchiveSchema extends Named<
  typeof workflowCascadeArchiveSchemaDefinition
> {}
export const workflowCascadeArchiveSchema: WorkflowCascadeArchiveSchema =
  workflowCascadeArchiveSchemaDefinition;

export type WorkflowProjectPath = z.infer<typeof workflowProjectPathSchema>;
export type WorkflowListRow = z.infer<typeof workflowListRowSchema>;
export type WorkflowCopyRow = z.infer<typeof workflowCopyRowSchema>;
export type WorkflowRelatedEntities = z.infer<typeof workflowRelatedEntitiesSchema>;
export type WorkflowCascadeArchive = z.infer<typeof workflowCascadeArchiveSchema>;
export type WorkflowPushToCopies = z.infer<typeof workflowPushToCopiesSchema>;
