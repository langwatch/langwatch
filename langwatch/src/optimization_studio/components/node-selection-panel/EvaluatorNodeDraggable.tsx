import type { Component } from "~/optimization_studio/types/dsl";
import type { NodeWithOptionalPosition } from "~/types";
import { MODULES } from "~/optimization_studio/registry";
import { NodeDraggable } from "./NodeDraggable";

type EvaluatorNodeDraggableProps = {
  onDragEnd?: (item: { node: NodeWithOptionalPosition<Component> }) => void;
};

/**
 * Single "Evaluator" draggable in the sidebar.
 *
 * Uses the first evaluator from MODULES.evaluators as the node template but
 * overrides the name and description to be generic. On drag-end the caller
 * (via useEvaluatorPickerFlow) opens the evaluator list drawer so the user
 * can choose an existing evaluator or create a new one.
 */
export function EvaluatorNodeDraggable({
  onDragEnd,
}: EvaluatorNodeDraggableProps) {
  const defaultEvaluator = MODULES.evaluators[0];

  if (!defaultEvaluator) {
    return null;
  }

  return (
    <NodeDraggable
      component={{
        ...defaultEvaluator,
        name: "Evaluator",
        description:
          "Drag and drop to add an evaluator node. Pick an existing evaluator or create a new one.",
      }}
      type="evaluator"
      onDragEnd={onDragEnd}
    />
  );
}
