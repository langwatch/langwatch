import { useMemo } from "react";

import { setFlowCallbacks, useDrawer } from "~/hooks/useDrawer";
import {
  useWorkflowEvaluatorPickerFlow,
  type EvaluatorPickerPort,
} from "@langwatch/workflow-web";

/** App composition adapter for the Workflow evaluator-selection state machine. */
export function useEvaluatorPickerFlow() {
  const { openDrawer, closeDrawer } = useDrawer();
  const port = useMemo<EvaluatorPickerPort>(
    () => ({
      register: (callbacks) => setFlowCallbacks("evaluatorList", callbacks),
      registerCreation: (onSave) => {
        setFlowCallbacks("evaluatorEditor", { onSave });
        setFlowCallbacks("workflowSelectorForEvaluator", { onSave });
      },
      openList: () => {
        setTimeout(() => openDrawer("evaluatorList", void 0, { resetStack: true }), 0);
      },
      openCategory: () => openDrawer("evaluatorCategorySelector"),
      close: closeDrawer,
    }),
    [closeDrawer, openDrawer],
  );

  return useWorkflowEvaluatorPickerFlow(port);
}
