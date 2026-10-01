import { defineSlice } from "@langwatch/browser-host/global-store";
import { WORKFLOW_HOST_SLICE, type WorkflowHostSlice } from "@langwatch/workflow-contract";

function unmounted(): never {
  throw new Error("No workflow host is mounted above this screen; mount the workflow module.");
}

/** `workflow:host`: workflow owns it, and its host mount fills in the actions. */
export const workflowHostSlice = defineSlice<WorkflowHostSlice>({
  name: WORKFLOW_HOST_SLICE,
  create: () => ({
    scope: unmounted,
    hasPermission: unmounted,
    copyTargets: unmounted,
    route: unmounted,
    setQuery: unmounted,
    navigate: unmounted,
    back: unmounted,
    succeeded: unmounted,
    failed: unmounted,
  }),
});
