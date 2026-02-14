import { merge } from "lodash-es";

import { useWorkflowStore } from "~/optimization_studio/hooks/useWorkflowStore";
import { MODULES } from "~/optimization_studio/registry";
import type { NodeWithOptionalPosition } from "~/types";
import type { Component } from "~/optimization_studio/types/dsl";

import { NodeDraggable } from "./NodeDraggable";

/**
 * Draggable component for LLM Signature nodes. Merges the workflow's
 * default LLM config into the signature template before creating the node.
 */
export function LlmSignatureNodeDraggable({
  onDragEnd,
}: {
  onDragEnd?: (item: { node: NodeWithOptionalPosition<Component> }) => void;
}) {
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
