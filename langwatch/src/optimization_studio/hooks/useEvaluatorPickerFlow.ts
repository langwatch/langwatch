import { useCallback, useRef } from "react";
import { setFlowCallbacks, useDrawer } from "~/hooks/useDrawer";
import type { Component } from "../types/dsl";
import type { NodeWithOptionalPosition } from "~/types";
import { useWorkflowStore } from "./useWorkflowStore";
import type { EvaluatorWithFields } from "~/server/evaluators/evaluator.service";

/**
 * Hook that provides a drag-end handler for the Evaluator node draggable.
 *
 * When an evaluator node is dropped on the canvas, this opens the
 * EvaluatorListDrawer so the user can pick an existing evaluator or create
 * a new one. The flow mirrors usePromptPickerFlow:
 *
 * - onSelect: updates the placeholder node with evaluator data, selects it
 * - onCreateNew: opens the evaluator category selector to create a new one
 * - onClose (cancel): removes the placeholder node from the canvas
 */
export function useEvaluatorPickerFlow() {
  const { openDrawer, closeDrawer } = useDrawer();
  const { setNode, deleteNode, setSelectedNode } = useWorkflowStore(
    (state) => ({
      setNode: state.setNode,
      deleteNode: state.deleteNode,
      setSelectedNode: state.setSelectedNode,
    }),
  );

  const pendingEvaluatorRef = useRef<string | null>(null);

  const handleEvaluatorDragEnd = useCallback(
    (item: { node: NodeWithOptionalPosition<Component> }) => {
      const nodeId = item.node.id;
      pendingEvaluatorRef.current = nodeId;

      setFlowCallbacks("evaluatorList", {
        onSelect: (evaluator: EvaluatorWithFields) => {
          if (pendingEvaluatorRef.current) {
            setNode({
              id: pendingEvaluatorRef.current,
              data: {
                name: evaluator.name,
                evaluator: `evaluators/${evaluator.id}`,
              } as Partial<Component>,
            });
            const nodeToSelect = pendingEvaluatorRef.current;
            pendingEvaluatorRef.current = null;
            closeDrawer();
            setSelectedNode(nodeToSelect);
          }
        },
        onCreateNew: () => {
          // Navigate to category selector to create a new evaluator
          openDrawer("evaluatorCategorySelector");
        },
        onClose: () => {
          // Cancel: remove the placeholder node
          if (pendingEvaluatorRef.current) {
            deleteNode(pendingEvaluatorRef.current);
            pendingEvaluatorRef.current = null;
          }
          closeDrawer();
        },
      });

      // Defer drawer opening to next tick so ReactFlow's D3 drag system
      // finishes processing the drop before we trigger a URL change (re-render).
      // Without this, the nodeLookup can become stale mid-drag-end.
      setTimeout(() => {
        openDrawer("evaluatorList", undefined, { resetStack: true });
      }, 0);
    },
    [openDrawer, closeDrawer, setNode, deleteNode, setSelectedNode],
  );

  return { handleEvaluatorDragEnd, pendingEvaluatorRef };
}
