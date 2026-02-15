import { useCallback, useRef } from "react";
import { setFlowCallbacks, useDrawer } from "~/hooks/useDrawer";
import type { Component, Field } from "../types/dsl";
import type { NodeWithOptionalPosition } from "~/types";
import { useWorkflowStore } from "./useWorkflowStore";
import type { EvaluatorWithFields } from "~/server/evaluators/evaluator.service";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "~/server/evaluations/evaluators.generated";

const FIELD_TYPE_MAP: Record<string, string> = {
  contexts: "list",
  expected_contexts: "list",
  conversation: "list",
};

/**
 * Computes inputs and outputs for a built-in evaluator from AVAILABLE_EVALUATORS.
 * Used when creating a new evaluator via onCreateNew to set correct node fields
 * without an extra API round-trip.
 */
function computeFieldsFromEvaluatorType(evaluatorType: string): {
  inputs: Field[];
  outputs: Field[];
} {
  const def = AVAILABLE_EVALUATORS[evaluatorType as EvaluatorTypes];
  if (!def) {
    return {
      inputs: [
        { identifier: "output", type: "str" },
        { identifier: "expected_output", type: "str", optional: true },
      ],
      outputs: [{ identifier: "passed", type: "bool" }],
    };
  }

  const inputs: Field[] = [
    ...(def.requiredFields ?? []).map((f) => ({
      identifier: f,
      type: (FIELD_TYPE_MAP[f] ?? "str") as Field["type"],
    })),
    ...(def.optionalFields ?? []).map((f) => ({
      identifier: f,
      type: (FIELD_TYPE_MAP[f] ?? "str") as Field["type"],
      optional: true,
    })),
  ];

  const outputs: Field[] = [];
  if (def.result.score) outputs.push({ identifier: "score", type: "float" });
  if (def.result.passed) outputs.push({ identifier: "passed", type: "bool" });
  if (def.result.label) outputs.push({ identifier: "label", type: "str" });
  outputs.push({ identifier: "details", type: "str" });

  return { inputs, outputs };
}

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
            const inputs: Field[] = (evaluator.fields ?? []).map((f) => ({
              identifier: f.identifier,
              type: f.type as Field["type"],
              ...(f.optional ? { optional: true } : {}),
            }));
            const outputs: Field[] = (evaluator.outputFields ?? []).map((f) => ({
              identifier: f.identifier,
              type: f.type as Field["type"],
            }));

            setNode({
              id: pendingEvaluatorRef.current,
              data: {
                name: evaluator.name,
                evaluator: `evaluators/${evaluator.id}`,
                inputs,
                outputs,
              } as Partial<Component>,
            });
            const nodeToSelect = pendingEvaluatorRef.current;
            pendingEvaluatorRef.current = null;
            closeDrawer();
            setSelectedNode(nodeToSelect);
          }
        },
        onCreateNew: () => {
          // Wire up so newly created evaluator is applied to the pending node
          const onEvaluatorSaved = (saved: {
            id: string;
            name: string;
            evaluatorType?: string;
          }) => {
            if (pendingEvaluatorRef.current) {
              const { inputs, outputs } = saved.evaluatorType
                ? computeFieldsFromEvaluatorType(saved.evaluatorType)
                : { inputs: undefined, outputs: undefined };

              setNode({
                id: pendingEvaluatorRef.current,
                data: {
                  name: saved.name,
                  evaluator: `evaluators/${saved.id}`,
                  ...(inputs ? { inputs } : {}),
                  ...(outputs ? { outputs } : {}),
                } as Partial<Component>,
              });
              const nodeId = pendingEvaluatorRef.current;
              pendingEvaluatorRef.current = null;
              closeDrawer();
              setSelectedNode(nodeId);
              return true; // Handled navigation
            }
          };
          // Both built-in and workflow evaluator creation paths
          setFlowCallbacks("evaluatorEditor", { onSave: onEvaluatorSaved });
          setFlowCallbacks("workflowSelectorForEvaluator", { onSave: onEvaluatorSaved });
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
