import { MODULES } from "../../model/studio-registry.ts";
import type { Component,NodeWithOptionalPosition } from "@langwatch/workflow-contract";
import { NodeDraggable } from "./workflow-node-draggable.tsx";

type EvaluatorNodeDraggableProps = {
  onDragEnd?: (item: { node: NodeWithOptionalPosition<Component> }) => void;
};

/**
 * Single "Evaluator" draggable in the sidebar. Uses the first evaluator from
 * MODULES.evaluators as the template, with a generic name/description. On
 * drag-end, useEvaluatorPickerFlow opens the drawer to pick or create one.
 */
export function EvaluatorNodeDraggable({ onDragEnd }: EvaluatorNodeDraggableProps) {
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
