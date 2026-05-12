import { merge } from "lodash-es";

import type { Component } from "~/optimization_studio/types/dsl";
import { useWorkflowStore } from "~/optimization_studio/hooks/useWorkflowStore";
import { MODULES } from "~/optimization_studio/registry";
import type { NodeWithOptionalPosition } from "~/types";

import { NodeDraggable } from "./NodeDraggable";

type LlmSignatureNodeDraggableProps = {
  onDragEnd?: (item: { node: NodeWithOptionalPosition<Component> }) => void;
};

export function LlmSignatureNodeDraggable({
  onDragEnd,
}: LlmSignatureNodeDraggableProps) {
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
      onDragEnd={onDragEnd}
    />
  );
}
