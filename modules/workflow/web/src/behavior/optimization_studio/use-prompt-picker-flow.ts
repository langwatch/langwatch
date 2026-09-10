import { useMemo } from "react";

import { setFlowCallbacks, useDrawer } from "@langwatch/ui-host/use-drawer";
import {
  useWorkflowPromptPickerFlow,
  type PromptPickerController,
} from "../use-workflow-prompt-picker-flow.ts";

/** App composition adapter for the Workflow prompt-selection state machine. */
export function usePromptPickerFlow() {
  const { openDrawer, closeDrawer } = useDrawer();
  const port = useMemo<PromptPickerController>(
    () => ({
      register: (callbacks) => setFlowCallbacks("promptList", callbacks),
      open: () => {
        setTimeout(() => openDrawer("promptList", void 0, { resetStack: true }), 0);
      },
      close: closeDrawer,
    }),
    [closeDrawer, openDrawer],
  );

  return useWorkflowPromptPickerFlow(port);
}
