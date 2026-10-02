/**
 * What the Workflows screens ask of the application they are mounted in,
 * read from the `workflow:host` slice that workflow's host mount publishes.
 */

import { readSlice } from "@langwatch/browser-host/global-store";
import { WORKFLOW_HOST_SLICE, type WorkflowHostSlice } from "@langwatch/workflow-contract";

export type {
  WorkflowCopyPermission,
  WorkflowCopyTarget,
  WorkflowFailureAction,
  WorkflowFailureNotice,
  WorkflowHostSlice,
  WorkflowRouteReading,
  WorkflowScope,
  WorkflowSuccessNotice,
} from "@langwatch/workflow-contract";

const workflowHostReader = readSlice<WorkflowHostSlice>({ name: WORKFLOW_HOST_SLICE });

export function useWorkflowHost(): WorkflowHostSlice {
  return workflowHostReader();
}

/** The grant the platform page asked for, unchanged. */
export const WORKFLOWS_PAGE_PERMISSION = "workflows:view";
