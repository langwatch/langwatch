import { z } from "zod";
import { studioWorkflowSchema } from "./studio-workflow";
import type {
  Workflow,
  WorkflowVersion,
  WorkflowVersionHistoryEntry,
  WorkflowWithVersion,
} from "./workflow";

/**
 * The transport inputs the workflow surface publishes.
 *
 * They live in the contract rather than beside the router because two
 * different clients are typed against them: the application's tRPC transport,
 * and the standalone workflow client the studio pages use.
 */

/** One project. Every project-scoped procedure on the surface takes it. */
export const workflowApiProjectInputSchema = z.object({
  projectId: z.string(),
});

/** One workflow inside one project. */
export const workflowApiWorkflowInputSchema = z.object({
  projectId: z.string(),
  workflowId: z.string(),
});

/** `engineMode` names the project it asks about, and nothing else. */
export const workflowApiEngineModeInputSchema = workflowApiProjectInputSchema;

/** `getById` names one workflow. */
export const workflowApiGetByIdInputSchema = workflowApiWorkflowInputSchema;

export const workflowApiGetVersionsInputSchema = z.object({
  projectId: z.string(),
  workflowId: z.string(),
  returnDSL: z.union([z.boolean(), z.literal("previousVersion")]).optional(),
});

export const workflowApiCreateInputSchema = z.object({
  projectId: z.string(),
  dsl: studioWorkflowSchema,
  commitMessage: z.string(),
  /** Auto-publish the first version (useful for evaluator workflows). */
  publish: z.boolean().optional(),
});

export const workflowApiCopyInputSchema = z.object({
  workflowId: z.string(),
  projectId: z.string(),
  sourceProjectId: z.string(),
  copyDatasets: z.boolean().optional(),
});

export const workflowApiRestoreVersionInputSchema = z.object({
  projectId: z.string(),
  versionId: z.string(),
});

export const workflowApiAutosaveInputSchema = z.object({
  projectId: z.string(),
  workflowId: z.string(),
  dsl: studioWorkflowSchema,
  setAsLatestVersion: z.boolean(),
});

export const workflowApiCommitVersionInputSchema = z.object({
  projectId: z.string(),
  workflowId: z.string(),
  commitMessage: z.string(),
  dsl: studioWorkflowSchema,
});

export const workflowApiPublishInputSchema = z.object({
  projectId: z.string(),
  workflowId: z.string(),
  versionId: z.string(),
});

export const workflowApiPushToCopiesInputSchema = z.object({
  projectId: z.string(),
  workflowId: z.string(),
  /** When present, only these copies are pushed to. */
  copyIds: z.array(z.string()).optional(),
});

export const workflowApiArchiveInputSchema = z.object({
  projectId: z.string(),
  workflowId: z.string(),
  unarchive: z.boolean().optional(),
});

export const workflowApiGenerateCommitMessageInputSchema = z.object({
  projectId: z.string(),
  prevDsl: studioWorkflowSchema,
  newDsl: studioWorkflowSchema,
});

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
 * The five writes the studio makes, answered with the row each one wrote.
 *
 * Every one of them is a contract DTO already — `WorkflowVersion` and
 * `Workflow` are the zod-inferred shapes this package declares — so stating
 * the outputs here restates nothing and leaks no Prisma row: `saveVersion`,
 * `restoreVersion` and `publish` on {@link WorkflowService} return exactly
 * these.
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
