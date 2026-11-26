import { readSlice } from "@langwatch/browser-host/global-store";
import { WORKFLOW_HOST_SLICE, type WorkflowHostSlice } from "@langwatch/workflow-contract";

import {
  WORKBENCH_RUN_PERMISSION,
  WORKBENCH_SAVE_PERMISSION,
  type WorkbenchAccess,
} from "../../model/experiments-v3/workbench-access.ts";

const useHostReader = readSlice<WorkflowHostSlice | null>({
  name: WORKFLOW_HOST_SLICE,
  absent: null,
});

/**
 * What the reader may do on the workbench, from their grants. With no host
 * published the page offers every control: the server still decides.
 */
export function useWorkbenchAccess(): WorkbenchAccess {
  const maySave = useHostReader((host) => host?.hasPermission(WORKBENCH_SAVE_PERMISSION) ?? true);
  const mayRun = useHostReader((host) => host?.hasPermission(WORKBENCH_RUN_PERMISSION) ?? true);
  return { maySave, mayRun };
}

/** The same answer read outside render, for a run started from a handler. */
export function readWorkbenchAccess(): WorkbenchAccess {
  const host = useHostReader.getState();
  return {
    maySave: host?.hasPermission(WORKBENCH_SAVE_PERMISSION) ?? true,
    mayRun: host?.hasPermission(WORKBENCH_RUN_PERMISSION) ?? true,
  };
}
