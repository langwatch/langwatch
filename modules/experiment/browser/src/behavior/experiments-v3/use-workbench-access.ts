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

type AccessRefusal = {
  refused: boolean;
  visit: number;
  markRefused: ({ visit }: { visit: number }) => void;
  reset: () => void;
};

/**
 * Set once the server refused a save for the reader's role; cleared when the page closes.
 * A refusal only counts for the visit that sent the save, so a late answer can't carry over.
 */
export const useWorkbenchAccessRefusal = defineSlice<AccessRefusal>({
  name: "experiment:workbench-access-refusal",
  create: (set, get) => ({
    refused: false,
    visit: 0,
    markRefused: ({ visit }) => {
      if (get().visit === visit) set({ refused: true });
    },
    reset: () => set({ refused: false, visit: get().visit + 1 }),
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
