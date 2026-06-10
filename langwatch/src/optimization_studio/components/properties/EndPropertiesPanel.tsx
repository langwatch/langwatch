import { Alert, Text } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkflowStore } from "~/optimization_studio/hooks/useWorkflowStore";
import type { End, Field } from "../../types/dsl";
import { BasePropertiesPanel } from "./BasePropertiesPanel";

/**
 * The full vocabulary an evaluator can return. When the workflow
 * behaves as an evaluator, the End node's results are exactly these
 * four - fixed identifiers and types, no add/remove/rename. Unused
 * fields simply stay unconnected.
 */
export const EVALUATOR_RESULT_FIELDS: Field[] = [
  { identifier: "passed", type: "bool", optional: true },
  { identifier: "score", type: "float", optional: true },
  { identifier: "details", type: "str", optional: true },
  { identifier: "label", type: "str", optional: true },
];

export function EndPropertiesPanel({ node: initialNode }: { node: Node<End> }) {
  const { node, edges, setNode } = useWorkflowStore(
    useShallow((state) => ({
      node: state.nodes.find((n) => n.id === initialNode.id) as Node<End>,
      edges: state.edges,
      setNode: state.setNode,
    })),
  );

  const isEvaluator = node.data.behave_as === "evaluator";

  // Pin the evaluator end node to the fixed result vocabulary. Existing
  // connections survive (identifiers passed/score keep their handles);
  // free-form fields users created by hand are replaced by the
  // contract, which is the point - the four options should be obvious,
  // not discovered by renaming "output" to "score" on a call.
  useEffect(() => {
    if (!isEvaluator) return;
    const current = node.data.inputs ?? [];
    const matchesContract =
      current.length === EVALUATOR_RESULT_FIELDS.length &&
      EVALUATOR_RESULT_FIELDS.every((f, i) => {
        const c = current[i];
        return c && c.identifier === f.identifier && c.type === f.type;
      });
    if (!matchesContract) {
      setNode({
        id: node.id,
        data: { ...node.data, inputs: EVALUATOR_RESULT_FIELDS },
      });
    }
  }, [isEvaluator, node.id, node.data, setNode]);

  const hasResultConnected = edges.some(
    (edge) =>
      edge.target === node.id &&
      (edge.targetHandle === "inputs.score" ||
        edge.targetHandle === "inputs.passed"),
  );

  return (
    <BasePropertiesPanel
      node={node}
      hideOutputs
      hideParameters
      inputsTitle="Results"
      inputsReadOnly={isEvaluator}
    >
      {isEvaluator && (
        <Text fontSize="13px" color="fg.muted">
          Evaluators return up to these four results. Connect the ones
          your workflow produces - unconnected results are simply
          omitted.
        </Text>
      )}
      {isEvaluator && !hasResultConnected && (
        <Alert.Root>
          <Alert.Indicator />
          <Alert.Content>
            <Text>
              Connect either a <b>score</b> or a <b>passed</b> result for
              this evaluator to be useful.
            </Text>
          </Alert.Content>
        </Alert.Root>
      )}
    </BasePropertiesPanel>
  );
}
