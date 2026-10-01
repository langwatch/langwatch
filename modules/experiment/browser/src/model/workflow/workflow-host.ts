import { readSlice } from "@langwatch/browser-host/global-store";
import { WORKFLOW_HOST_SLICE, type WorkflowHostSlice } from "@langwatch/workflow-contract";

const workflowHostReader = readSlice<WorkflowHostSlice>({ name: WORKFLOW_HOST_SLICE });

/** Workflow's host actions, read from the `workflow:host` slice its host mount publishes. */
export function useWorkflowHost(): WorkflowHostSlice {
  return workflowHostReader();
}
