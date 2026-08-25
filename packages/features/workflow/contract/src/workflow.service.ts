import type {
  ArchiveWorkflowCommand,
  CopyWorkflowCommand,
  CreateWorkflowCommand,
  PublishWorkflowCommand,
  RunWorkflowCommand,
  SaveWorkflowVersionCommand,
  UpdateWorkflowCommand,
} from "./workflow.commands";
import type {
  Workflow,
  WorkflowEvaluatorFields,
  WorkflowVersion,
  WorkflowVersionHistoryEntry,
  WorkflowVersionHistoryMode,
  WorkflowWithVersion,
} from "./workflow";

export abstract class WorkflowService {
  abstract getById(input: {
    id: string;
    projectId: string;
    includeVersion?: boolean;
  }): Promise<WorkflowWithVersion>;
  abstract assertInProject(input: {
    workflowId: string;
    projectId: string;
  }): Promise<void>;
  abstract getFields(input: {
    workflowId: string;
    projectId: string;
  }): Promise<WorkflowEvaluatorFields>;
  abstract list(input: { projectId: string }): Promise<Workflow[]>;
  abstract getVersions(input: {
    workflowId: string;
    projectId: string;
    includeDsl?: boolean;
  }): Promise<WorkflowVersion[]>;
  abstract getVersionHistory(input: {
    workflowId: string;
    projectId: string;
    mode: WorkflowVersionHistoryMode;
  }): Promise<WorkflowVersionHistoryEntry[]>;
  abstract restoreVersion(input: {
    versionId: string;
    projectId: string;
  }): Promise<WorkflowVersion>;
  abstract getPublishedVersion(input: {
    workflowId: string;
    projectId: string;
    versionId?: string;
  }): Promise<WorkflowVersion>;
  abstract create(
    input: CreateWorkflowCommand,
  ): Promise<{ workflow: WorkflowWithVersion; version: WorkflowVersion }>;
  abstract update(input: UpdateWorkflowCommand): Promise<Workflow>;
  abstract saveVersion(input: SaveWorkflowVersionCommand): Promise<WorkflowVersion>;
  abstract publish(input: PublishWorkflowCommand): Promise<Workflow>;
  abstract unpublish(input: { id: string; projectId: string }): Promise<Workflow>;
  abstract archive(input: ArchiveWorkflowCommand): Promise<Workflow>;
  abstract copy(
    input: CopyWorkflowCommand,
  ): Promise<{ workflow: WorkflowWithVersion; version: WorkflowVersion }>;
  abstract getCopies(input: {
    workflowId: string;
    projectId: string;
  }): Promise<Workflow[]>;
  abstract pushToCopies(input: {
    workflowId: string;
    projectId: string;
    copyIds?: string[];
    allowedProjectIds?: string[];
  }): Promise<{ pushedTo: number; selectedCopies: number }>;
  abstract run(input: RunWorkflowCommand): Promise<unknown>;
}
