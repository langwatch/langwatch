import { featureApi } from "@langwatch/runtime-composition";

/** Callable capability exposed by the composed Workflow application. */
export interface WorkflowApi {
  assertInProject(input: { workflowId: string; projectId: string }): Promise<void>;
}

export const WorkflowApi = featureApi<WorkflowApi>("workflow");
