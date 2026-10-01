import { readSlice } from "@langwatch/browser-host/global-store";
import { WORKFLOW_HOST_SLICE, type WorkflowHostSlice } from "@langwatch/workflow-contract";

type WorkflowNavigation = Pick<WorkflowHostSlice, "navigate">;

/** Where workflow is not installed, a link is left to the browser. */
const workflowHostReader = readSlice<WorkflowNavigation>({
  name: WORKFLOW_HOST_SLICE,
  absent: { navigate: (to) => window.location.assign(to) },
});

/** The one workflow host action evaluator uses, read from the `workflow:host` slice. */
export function useWorkflowHost(): WorkflowNavigation {
  return workflowHostReader();
}
