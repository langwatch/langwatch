import { z } from "zod";

/**
 * The Studio graph is deliberately open-ended: new node kinds are shipped by
 * the execution engine independently of this control-plane package. The
 * envelope is strict and the graph values remain portable JSON.
 */
export const workflowDslSchema = z
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

export type WorkflowDsl = z.infer<typeof workflowDslSchema>;

export const workflowRunOriginSchema = z.enum([
  "workflow",
  "playground",
  "evaluation",
  "scenario",
  "topic_clustering",
]);
export type WorkflowRunOrigin = z.infer<typeof workflowRunOriginSchema>;

export const workflowSchema = z.object({
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

export type Workflow = z.infer<typeof workflowSchema>;

export const workflowVersionSchema = z.object({
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

export type WorkflowVersion = z.infer<typeof workflowVersionSchema>;

export type WorkflowWithVersion = Workflow & {
  currentVersion?: WorkflowVersion | null;
  latestVersion?: WorkflowVersion | null;
};

export const workflowFieldSchema = z.object({
  identifier: z.string().min(1),
  type: z.string().min(1),
  optional: z.boolean().optional(),
});

export type WorkflowField = z.infer<typeof workflowFieldSchema>;

/** Portable field metadata consumed by Evaluator without a Workflow repository. */
export type WorkflowEvaluatorFields = {
  workflowId: string;
  workflowName: string;
  workflowIcon?: string;
  fields: WorkflowField[];
  outputFields: WorkflowField[];
};
