import { useMemo } from "react";

import { setFlowCallbacks, useDrawer } from "~/hooks/useDrawer";
import {
  useWorkflowAgentPickerFlow,
  type AgentPickerPort,
} from "@langwatch/workflow-web";

/** App composition adapter for the Workflow agent-selection state machine. */
export function useAgentPickerFlow() {
  const { openDrawer, closeDrawer } = useDrawer();
  const port = useMemo<AgentPickerPort>(
    () => ({
      register: (callbacks) => setFlowCallbacks("agentList", callbacks),
      registerCreation: (onSave) => {
        setFlowCallbacks("agentHttpEditor", { onSave });
        setFlowCallbacks("agentCodeEditor", { onSave });
        setFlowCallbacks("workflowSelector", { onSave });
      },
      openList: () => {
        setTimeout(() => openDrawer("agentList", void 0, { resetStack: true }), 0);
      },
      openTypeSelector: () => openDrawer("agentTypeSelector"),
      close: closeDrawer,
    }),
    [closeDrawer, openDrawer],
  );

  return useWorkflowAgentPickerFlow(port);
}
