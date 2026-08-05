/**
 * Types for the Recent Items module
 */

export type RecentItemType =
  | "prompt"
  | "workflow"
  | "dataset"
  | "evaluation"
  | "annotation"
  | "simulation";

export type RecentItem = {
  id: string;
  type: RecentItemType;
  name: string;
  href: string;
  updatedAt: Date;
};

export type GetRecentItemsParams = {
  userId: string;
  projectId: string;
  limit: number;
};

/**
 * Mapping of AuditLog action prefixes to entity types
 */
export const ACTION_TO_TYPE_MAP: Record<string, RecentItemType> = {
  "prompts.": "prompt",
  "workflow.": "workflow",
  "dataset.": "dataset",
  "datasetRecord.": "dataset",
  "monitors.": "evaluation",
  "annotation.": "annotation",
  "scenarios.": "simulation",
};

/**
 * Extract entity ID from audit log args based on action type
 */
export const ENTITY_ID_EXTRACTORS: Record<
  RecentItemType,
  (args: Record<string, unknown>) => string | null
> = {
  prompt: (args) => (args.configId as string) ?? null,
  workflow: (args) => (args.workflowId as string) ?? null,
  dataset: (args) => (args.datasetId as string) ?? null,
  evaluation: (args) =>
    (args.checkId as string) ?? (args.monitorId as string) ?? null,
  annotation: (args) => (args.annotationQueueId as string) ?? null,
  simulation: (args) => (args.scenarioSetId as string) ?? null,
};
