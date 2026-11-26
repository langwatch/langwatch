import { defineSlice, readSlice } from "@langwatch/browser-host/global-store";
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

type AccessRefusal = { refused: boolean; markRefused: () => void; reset: () => void };

/** Set once the server refused a save for the reader's role; cleared when the page closes. */
export const useWorkbenchAccessRefusal = defineSlice<AccessRefusal>({
  name: "experiment:workbench-access-refusal",
  create: (set) => ({
    refused: false,
    markRefused: () => set({ refused: true }),
    reset: () => set({ refused: false }),
  }),
});

const accessOf = ({
  host,
  refused,
}: {
  host: WorkflowHostSlice | null;
  refused: boolean;
}): WorkbenchAccess => ({
  maySave: !refused && (host?.hasPermission(WORKBENCH_SAVE_PERMISSION) ?? true),
  mayRun: !refused && (host?.hasPermission(WORKBENCH_RUN_PERMISSION) ?? true),
});

/**
 * What the reader may do on the workbench: their grants, narrowed by a role
 * refusal the server sent this visit. With no host published the page offers
 * every control; the server still decides.
 */
export function useWorkbenchAccess(): WorkbenchAccess {
  const host = useHostReader();
  const refused = useWorkbenchAccessRefusal((state) => state.refused);
  return accessOf({ host, refused });
}

/** The same answer read outside render, for a save or run started from a handler. */
export function readWorkbenchAccess(): WorkbenchAccess {
  return accessOf({
    host: useHostReader.getState(),
    refused: useWorkbenchAccessRefusal.getState().refused,
  });
}
