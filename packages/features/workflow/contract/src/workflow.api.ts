import { featureApi } from "@langwatch/runtime-composition";
import type { CopyWorkflowCommand } from "./workflow.commands.ts";
import type { ExecutionState, Field } from "./studio-workflow.ts";
import type { ExecuteWorkflowComponentInput } from "./workflow-component.commands.ts";
import type { WorkflowVersion, WorkflowWithVersion } from "./workflow.ts";

export type WorkflowMappingFields = {
  inputFields: Field[];
  outputFields: Field[];
  fieldsResolved: boolean;
};

export type WorkflowReference = { workflowId: string; projectId: string };

/** Callable capability exposed by the composed Workflow application. */
export interface WorkflowApi {
  executeComponent(input: ExecuteWorkflowComponentInput): Promise<ExecutionState>;
  assertInProject(input: { workflowId: string; projectId: string }): Promise<void>;
  listFields(input: {
    projectId: string;
    workflowIds: string[];
  }): Promise<Record<string, WorkflowMappingFields>>;
  listSummaries(input: {
    projectId: string;
    workflowIds: string[];
  }): Promise<{ id: string; name: string }[]>;
  archiveLinked(input: WorkflowReference): Promise<{ id: string }>;
  deleteUncommitted(input: WorkflowReference): Promise<void>;
  copy(
    input: CopyWorkflowCommand,
    by: { id: string },
  ): Promise<{ workflow: WorkflowWithVersion; version: WorkflowVersion }>;
}

export const WorkflowApi = featureApi<WorkflowApi>("workflow");
