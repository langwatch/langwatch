import { useCallback, useRef } from "react";

import type { EvaluatorWithFields } from "@langwatch/evaluator-contract";
import { AVAILABLE_EVALUATORS } from "@langwatch/evaluator-contract";
import type {
  Component,
  Field,
  NodeWithOptionalPosition,
} from "@langwatch/workflow-contract";
import { fieldSchema } from "@langwatch/workflow-contract";

import { useWorkflowStore } from "./use-workflow-store";

type SavedEvaluator = { id: string; name: string; evaluatorType?: string };
type EvaluatorSaveResult = boolean | void;

export type EvaluatorPickerCallbacks = {
  onSelect: (evaluator: EvaluatorWithFields) => void;
  onCreateNew: () => void;
  onClose: () => void;
};

export type EvaluatorPickerPort = {
  register: (callbacks: EvaluatorPickerCallbacks) => void;
  registerCreation: (onSave: (evaluator: SavedEvaluator) => EvaluatorSaveResult) => void;
  openList: () => void;
  openCategory: () => void;
  close: () => void;
};

const FIELD_TYPE_MAP: Record<string, string> = {
  contexts: "list",
  expected_contexts: "list",
  conversation: "list",
};

function computeFieldsFromEvaluatorType(evaluatorType: string): {
  inputs: Field[];
  outputs: Field[];
} {
  const definition = Object.entries(AVAILABLE_EVALUATORS).find(
    ([key]) => key === evaluatorType,
  )?.[1];
  if (!definition) {
    return {
      inputs: [
        { identifier: "output", type: "str" },
        { identifier: "expected_output", type: "str", optional: true },
      ],
      outputs: [{ identifier: "passed", type: "bool" }],
    };
  }

  const inputs: Field[] = [
    ...(definition.requiredFields ?? []).map((identifier) =>
      fieldSchema.parse({
        identifier,
        type: FIELD_TYPE_MAP[identifier] ?? "str",
      }),
    ),
    ...(definition.optionalFields ?? []).map((identifier) =>
      fieldSchema.parse({
        identifier,
        type: FIELD_TYPE_MAP[identifier] ?? "str",
        optional: true,
      }),
    ),
  ];
  const outputs: Field[] = [];
  if (definition.result.score) {
    outputs.push(fieldSchema.parse({ identifier: "score", type: "float" }));
  }
  if (definition.result.passed) {
    outputs.push(fieldSchema.parse({ identifier: "passed", type: "bool" }));
  }
  if (definition.result.label) {
    outputs.push(fieldSchema.parse({ identifier: "label", type: "str" }));
  }
  return { inputs, outputs };
}

/** Workflow-owned state transition for selecting an evaluator after a canvas drop. */
export function useWorkflowEvaluatorPickerFlow(port: EvaluatorPickerPort) {
  const { setNode, deleteNode, setSelectedNode } = useWorkflowStore((state) => ({
    setNode: state.setNode,
    deleteNode: state.deleteNode,
    setSelectedNode: state.setSelectedNode,
  }));
  const pendingEvaluatorRef = useRef<string | null>(null);

  const handleEvaluatorDragEnd = useCallback(
    (item: { node: NodeWithOptionalPosition<Component> }) => {
      const nodeId = item.node.id;

      pendingEvaluatorRef.current = nodeId;
      port.register({
        onSelect: (evaluator) => {
          if (!pendingEvaluatorRef.current) {
            return;
          }
          const selectedNodeId = pendingEvaluatorRef.current;
          const inputs = (evaluator.fields ?? []).map((field) =>
            fieldSchema.parse({
              identifier: field.identifier,
              type: field.type,
              ...(field.optional ? { optional: true } : {}),
            }),
          );
          const outputs = (evaluator.outputFields ?? []).map((field) =>
            fieldSchema.parse({ identifier: field.identifier, type: field.type }),
          );
          setNode({
            id: selectedNodeId,
            data: {
              name: evaluator.name,
              evaluator: `evaluators/${evaluator.id}`,
              inputs,
              outputs,
            },
          });
          pendingEvaluatorRef.current = null;
          port.close();
          setSelectedNode(selectedNodeId);
        },
        onCreateNew: () => {
          port.registerCreation((saved) => {
            if (!pendingEvaluatorRef.current) {
              return;
            }
            const fields = saved.evaluatorType
              ? computeFieldsFromEvaluatorType(saved.evaluatorType)
              : {
                  inputs: [],
                  outputs: [fieldSchema.parse({ identifier: "passed", type: "bool" })],
                };
            const selectedNodeId = pendingEvaluatorRef.current;
            setNode({
              id: selectedNodeId,
              data: {
                name: saved.name,
                evaluator: `evaluators/${saved.id}`,
                inputs: fields.inputs,
                outputs: fields.outputs,
              },
            });
            pendingEvaluatorRef.current = null;
            port.close();
            setSelectedNode(selectedNodeId);
            return true;
          });
          port.openCategory();
        },
        onClose: () => {
          if (pendingEvaluatorRef.current) {
            deleteNode(pendingEvaluatorRef.current);
            pendingEvaluatorRef.current = null;
          }
          port.close();
        },
      });
      port.openList();
    },
    [deleteNode, port, setNode, setSelectedNode],
  );

  return { handleEvaluatorDragEnd, pendingEvaluatorRef };
}
