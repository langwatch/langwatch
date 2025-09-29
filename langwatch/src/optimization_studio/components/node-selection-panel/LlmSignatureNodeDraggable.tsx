import { useWorkflowStore } from "~/optimization_studio/hooks/useWorkflowStore";
import { NodeDraggable } from "./NodeDraggable";
import { MODULES } from "~/optimization_studio/registry";
import { merge } from "lodash-es";

export function LlmSignatureNodeDraggable() {
  const { getWorkflow } = useWorkflowStore((state) => ({
    getWorkflow: state.getWorkflow,
  }));

  const defaultLLMConfig = getWorkflow().default_llm;

  return (
    <NodeDraggable
      component={merge(MODULES.signature, {
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
