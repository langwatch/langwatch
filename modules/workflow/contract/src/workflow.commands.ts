import { z } from "zod";

import { workflowDslSchema, workflowRunOriginSchema } from "./workflow.ts";

export const createWorkflowCommandSchema = z.object({
  id: z.string().optional(),
  projectId: z.string(),
  dsl: workflowDslSchema,
  commitMessage: z.string(),
  publish: z.boolean().optional(),
  authorId: z.string().optional(),
  /** Stores version one as an autosave that later autosaves update in place; default committed. */
  autoSaved: z.boolean().optional(),
});

export const saveWorkflowVersionCommandSchema = z.object({
  projectId: z.string(),
  workflowId: z.string(),
  dsl: workflowDslSchema,
  commitMessage: z.string(),
  autoSaved: z.boolean(),
  authorId: z.string().optional(),
  setAsLatestVersion: z.boolean().optional(),
});

export const updateWorkflowCommandSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string().min(1).optional(),
  icon: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

export const archiveWorkflowCommandSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  unarchive: z.boolean().optional(),
});

export const publishWorkflowCommandSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  versionId: z.string(),
  actorId: z.string().optional(),
});

export const copyWorkflowCommandSchema = z.object({
  sourceWorkflowId: z.string(),
  sourceProjectId: z.string(),
  targetProjectId: z.string(),
  copiedFromWorkflowId: z.string().optional(),
  copyDatasets: z.boolean().optional(),
  id: z.string().optional(),
  authorId: z.string().optional(),
});

/**
 * The member a run acts as, and the key they started it with. The key minted for the run is
 * theirs, holding no more than they or that key do; a run that names nobody gets an ownerless key.
 */
export const workflowRunPrincipalSchema = z
  .object({ userId: z.string().min(1), callerApiKeyId: z.string().min(1).optional() })
  .strict();
export type WorkflowRunPrincipal = z.infer<typeof workflowRunPrincipalSchema>;

/**
 * Dispatch input shared by every workflow transport. The graph is resolved by
 * the service, so callers can only name the workflow and an optional version.
 */
export const runWorkflowCommandSchema = z.object({
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

export type CreateWorkflowCommand = z.infer<typeof createWorkflowCommandSchema>;
export type SaveWorkflowVersionCommand = z.infer<typeof saveWorkflowVersionCommandSchema>;
export type UpdateWorkflowCommand = z.infer<typeof updateWorkflowCommandSchema>;
export type ArchiveWorkflowCommand = z.infer<typeof archiveWorkflowCommandSchema>;
export type PublishWorkflowCommand = z.infer<typeof publishWorkflowCommandSchema>;
export type CopyWorkflowCommand = z.infer<typeof copyWorkflowCommandSchema>;
export type RunWorkflowCommand = z.infer<typeof runWorkflowCommandSchema>;
