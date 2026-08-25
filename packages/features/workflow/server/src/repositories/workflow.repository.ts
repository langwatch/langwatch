import type {
  Workflow,
  WorkflowDsl,
  WorkflowVersion,
  WorkflowWithVersion,
} from "@langwatch/workflow-contract";

export type PersistWorkflowInput = {
  id: string;
  projectId: string;
  name: string;
  icon: string | null;
  description: string | null;
  isEvaluator?: boolean;
  isComponent?: boolean;
  copiedFromWorkflowId?: string | null;
};

export type PersistWorkflowVersionInput = {
  id: string;
  workflowId: string;
  projectId: string;
  parentId: string | null;
  version: string;
  autoSaved: boolean;
  commitMessage: string;
  authorId?: string;
  dsl: WorkflowDsl;
};

export type WorkflowVersionHistoryRecord = {
  id: string;
  version: string;
  autoSaved: boolean;
  commitMessage: string;
  updatedAt: Date;
  dsl?: WorkflowDsl;
  parent: {
    id: string;
    version: string;
    commitMessage: string;
  } | null;
  author: { name: string | null; image: string | null } | null;
};

export abstract class WorkflowRepository {
  abstract tryFindById(input: {
    id: string;
    projectId: string;
    includeVersion?: boolean;
    includeArchived?: boolean;
  }): Promise<WorkflowWithVersion | null>;
  abstract findAll(input: { projectId: string }): Promise<Workflow[]>;
  abstract findVersions(input: { workflowId: string; projectId: string; includeDsl?: boolean }): Promise<WorkflowVersion[]>;
  abstract findVersionHistory(input: {
    workflowId: string;
    projectId: string;
    includeDsl: boolean;
  }): Promise<WorkflowVersionHistoryRecord[]>;
  abstract tryFindVersionById(input: {
    id: string;
    projectId: string;
  }): Promise<WorkflowVersion | null>;
  abstract tryFindVersion(input: { id: string; workflowId: string; projectId: string }): Promise<WorkflowVersion | null>;
  abstract tryFindPublishedVersion(input: { workflowId: string; projectId: string; versionId?: string }): Promise<WorkflowVersion | null>;
  abstract createWorkflow(input: PersistWorkflowInput): Promise<WorkflowWithVersion>;
  abstract updateWorkflow(input: { id: string; projectId: string; data: Record<string, unknown> }): Promise<Workflow>;
  abstract createVersion(input: PersistWorkflowVersionInput): Promise<WorkflowVersion>;
  abstract updateAutoSavedVersion(input: PersistWorkflowVersionInput & { id: string }): Promise<WorkflowVersion>;
  abstract setVersionPointers(input: { id: string; projectId: string; currentVersionId: string; latestVersionId?: string | null }): Promise<void>;
  abstract publish(input: { id: string; projectId: string; versionId: string; actorId?: string }): Promise<Workflow>;
  abstract findCopies(input: { workflowId: string; projectId: string }): Promise<Workflow[]>;
}
