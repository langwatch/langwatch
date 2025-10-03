import { merge } from "lodash-es";

import { useWorkflowStore } from "~/optimization_studio/hooks/useWorkflowStore";
import { MODULES } from "~/optimization_studio/registry";

import { NodeDraggable } from "./NodeDraggable";

export function LlmSignatureNodeDraggable() {
  const { getWorkflow } = useWorkflowStore((state) => ({
    getWorkflow: state.getWorkflow,
  }));

  const defaultLLMConfig = getWorkflow().default_llm;

  return (
    <NodeDraggable
      component={merge({}, MODULES.signature, {
        parameters: [
          {
            identifier: "llm",
            type: "llm",
            value: defaultLLMConfig,
          },
        ],
      })}
      type="signature"
    />
  );
}
