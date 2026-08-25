import type {
  ArchiveWorkflowCommand,
  CopyWorkflowCommand,
  CreateWorkflowCommand,
  PublishWorkflowCommand,
  RunWorkflowCommand,
  SaveWorkflowVersionCommand,
  StudioClientEvent,
  UpdateWorkflowCommand,
  Workflow,
  WorkflowEvaluatorFields,
  WorkflowVersion,
  WorkflowVersionHistoryEntry,
  WorkflowVersionHistoryMode,
  WorkflowWithVersion,
} from "@langwatch/workflow-contract";
import { WorkflowService as WorkflowServiceContract } from "@langwatch/workflow-contract";

export class TestWorkflowService extends WorkflowServiceContract {
  enrichStudioEvent(input: {
    event: StudioClientEvent;
    projectId: string;
  }): Promise<StudioClientEvent> {
    return Promise.resolve(input.event);
  }

  prepareStudioEvent(input: {
    event: StudioClientEvent;
    projectId: string;
  }): Promise<StudioClientEvent> {
    return Promise.resolve(input.event);
  }

  getById(_input: {
    id: string;
    projectId: string;
    includeVersion?: boolean;
  }): Promise<WorkflowWithVersion> {
    throw new Error("Not used by this executor test.");
  }

  assertInProject(_input: { workflowId: string; projectId: string }): Promise<void> {
    throw new Error("Not used by this executor test.");
  }

  getFields(_input: {
    workflowId: string;
    projectId: string;
  }): Promise<WorkflowEvaluatorFields> {
    throw new Error("Not used by this executor test.");
  }

  list(_input: { projectId: string }): Promise<Workflow[]> {
    throw new Error("Not used by this executor test.");
  }

  getVersions(_input: {
    workflowId: string;
    projectId: string;
    includeDsl?: boolean;
  }): Promise<WorkflowVersion[]> {
    throw new Error("Not used by this executor test.");
  }

  getVersionHistory(_input: {
    workflowId: string;
    projectId: string;
    mode: WorkflowVersionHistoryMode;
  }): Promise<WorkflowVersionHistoryEntry[]> {
    throw new Error("Not used by this executor test.");
  }

  restoreVersion(_input: {
    versionId: string;
    projectId: string;
  }): Promise<WorkflowVersion> {
    throw new Error("Not used by this executor test.");
  }

  getPublishedVersion(_input: {
    workflowId: string;
    projectId: string;
    versionId?: string;
  }): Promise<WorkflowVersion> {
    throw new Error("Not used by this executor test.");
  }

  create(
    _input: CreateWorkflowCommand,
  ): Promise<{ workflow: WorkflowWithVersion; version: WorkflowVersion }> {
    throw new Error("Not used by this executor test.");
  }

  update(_input: UpdateWorkflowCommand): Promise<Workflow> {
    throw new Error("Not used by this executor test.");
  }

  saveVersion(_input: SaveWorkflowVersionCommand): Promise<WorkflowVersion> {
    throw new Error("Not used by this executor test.");
  }

  publish(_input: PublishWorkflowCommand): Promise<Workflow> {
    throw new Error("Not used by this executor test.");
  }

  unpublish(_input: { id: string; projectId: string }): Promise<Workflow> {
    throw new Error("Not used by this executor test.");
  }

  archive(_input: ArchiveWorkflowCommand): Promise<Workflow> {
    throw new Error("Not used by this executor test.");
  }

  copy(
    _input: CopyWorkflowCommand,
  ): Promise<{ workflow: WorkflowWithVersion; version: WorkflowVersion }> {
    throw new Error("Not used by this executor test.");
  }

  getCopies(_input: { workflowId: string; projectId: string }): Promise<Workflow[]> {
    throw new Error("Not used by this executor test.");
  }

  pushToCopies(_input: {
    workflowId: string;
    projectId: string;
    copyIds?: string[];
    allowedProjectIds?: string[];
  }): Promise<{ pushedTo: number; selectedCopies: number }> {
    throw new Error("Not used by this executor test.");
  }

  run(_input: RunWorkflowCommand): Promise<unknown> {
    throw new Error("Not used by this executor test.");
  }
}
